#!/usr/bin/env python3
import hashlib
import json
import os
import re
import shutil
import socketserver
import subprocess
import tarfile
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

CRM_DIR = Path("/opt/mozy-crm")
BACKUP_DIR = Path("/opt/mozy-crm-backups")
UPLOAD_DIR = CRM_DIR / "data" / "update-uploads"
SOCKET_PATH = Path("/run/mozy-crm-maintenance/maintenance.sock")
JOBS_DIR = Path("/var/lib/mozy-crm-maintenance/jobs")
BACKUP_RE = re.compile(r"^mozy-backup-\d{8}-\d{6}\.tar\.gz$")
JOB_RE = re.compile(r"^[a-f0-9]{24}$")
MAX_PACKAGE_BYTES = 100 * 1024 * 1024
MAX_EXPANDED_BYTES = 250 * 1024 * 1024
MAX_PACKAGE_FILES = 1000
ALLOWED_FILE_PREFIXES = ("src/", "public/", "scripts/")
ALLOWED_FILE_NAMES = {
    "package.json",
    "package-lock.json",
    "Dockerfile",
    "docker-compose.yml",
}
jobs_lock = threading.Lock()
operation_lock = threading.Lock()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command, *, cwd=None, stdin=None, stdout=None, timeout=900):
    return subprocess.run(
        command,
        cwd=cwd,
        stdin=stdin,
        stdout=stdout,
        stderr=subprocess.PIPE,
        check=True,
        timeout=timeout,
        text=False,
    )


def job_path(job_id):
    return JOBS_DIR / f"{job_id}.json"


def save_job(job_id, **changes):
    with jobs_lock:
        path = job_path(job_id)
        current = {}
        if path.exists():
            current = json.loads(path.read_text("utf-8"))
        current.update(changes)
        current["updated_at"] = utc_now()
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(current, ensure_ascii=False, indent=2),
            "utf-8",
        )
        os.replace(temporary, path)
        return current


def create_job(kind):
    job_id = uuid.uuid4().hex[:24]
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    save_job(
        job_id,
        id=job_id,
        kind=kind,
        status="queued",
        message="Operațiunea a fost programată.",
        created_at=utc_now(),
    )
    return job_id


def add_tree_to_tar(archive, root, archive_prefix, excluded):
    root = Path(root)
    if not root.exists():
        return
    for current, directories, files in os.walk(root):
        current_path = Path(current)
        relative = current_path.relative_to(root)
        directories[:] = sorted(
            item
            for item in directories
            if not excluded(relative / item, True)
        )
        for name in sorted(files):
            relative_file = relative / name
            if excluded(relative_file, False):
                continue
            source = root / relative_file
            archive.add(
                source,
                arcname=str(Path(archive_prefix) / relative_file),
                recursive=False,
            )


def create_backup(job_id=None):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_name = f"mozy-backup-{stamp}.tar.gz"
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    final_path = BACKUP_DIR / backup_name
    temporary_path = BACKUP_DIR / f".{backup_name}.partial"

    with tempfile.TemporaryDirectory(
        prefix="mozy-backup-",
        dir="/var/tmp",
    ) as temporary:
        temporary_dir = Path(temporary)
        database_dump = temporary_dir / "database.sql"
        if job_id:
            save_job(
                job_id,
                status="running",
                progress=15,
                message="Se exportă baza de date.",
            )
        with open(database_dump, "wb") as output:
            run(
                [
                    "docker",
                    "exec",
                    "postgres",
                    "sh",
                    "-lc",
                    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                ],
                stdout=output,
            )

        if job_id:
            save_job(
                job_id,
                progress=40,
                message="Se arhivează sursa și fișierele CRM.",
            )

        manifest = {
            "format": "mozy-full-backup-v1",
            "created_at": utc_now(),
            "includes": [
                "sursa CRM și configurarea .env",
                "export complet PostgreSQL",
                "fișiere operaționale din data",
            ],
        }
        manifest_path = temporary_dir / "backup-manifest.json"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            "utf-8",
        )

        def source_excluded(relative, is_directory):
            parts = relative.parts
            if not parts:
                return False
            if parts[0] in {".git", "node_modules", "data"}:
                return True
            if is_directory and "backup" in parts[0].lower():
                return True
            return False

        def data_excluded(relative, _is_directory):
            return bool(
                relative.parts
                and relative.parts[0] in {
                    "system-backups",
                    "update-uploads",
                }
            )

        with tarfile.open(temporary_path, "w:gz") as archive:
            archive.add(
                manifest_path,
                arcname="backup-manifest.json",
                recursive=False,
            )
            archive.add(
                database_dump,
                arcname="database/database.sql",
                recursive=False,
            )
            add_tree_to_tar(
                archive,
                CRM_DIR,
                "source/mozy-crm",
                source_excluded,
            )
            add_tree_to_tar(
                archive,
                CRM_DIR / "data",
                "data",
                data_excluded,
            )
        os.replace(temporary_path, final_path)

    checksum = sha256_file(final_path)
    (BACKUP_DIR / f"{backup_name}.sha256").write_text(
        f"{checksum}  {backup_name}\n",
        "ascii",
    )
    return {
        "name": backup_name,
        "size": final_path.stat().st_size,
        "sha256": checksum,
        "created_at": datetime.fromtimestamp(
            final_path.stat().st_mtime,
            timezone.utc,
        ).isoformat(),
    }


def backup_worker(job_id):
    try:
        with operation_lock:
            result = create_backup(job_id)
        save_job(
            job_id,
            status="completed",
            progress=100,
            message="Backupul complet a fost creat.",
            result=result,
        )
    except Exception as error:
        save_job(
            job_id,
            status="failed",
            message=f"Backupul a eșuat: {error}",
        )


def list_backups():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for path in sorted(BACKUP_DIR.glob("mozy-backup-*.tar.gz"), reverse=True):
        if not BACKUP_RE.fullmatch(path.name):
            continue
        checksum_path = BACKUP_DIR / f"{path.name}.sha256"
        checksum = ""
        if checksum_path.exists():
            checksum = checksum_path.read_text("ascii").split()[0]
        result.append(
            {
                "name": path.name,
                "size": path.stat().st_size,
                "sha256": checksum,
                "created_at": datetime.fromtimestamp(
                    path.stat().st_mtime,
                    timezone.utc,
                ).isoformat(),
            }
        )
    return result[:30]


def safe_member_name(name):
    pure = PurePosixPath(name)
    return (
        bool(name)
        and not pure.is_absolute()
        and ".." not in pure.parts
        and "\\" not in name
    )


def allowed_payload_path(relative):
    return (
        relative in ALLOWED_FILE_NAMES
        or any(relative.startswith(prefix) for prefix in ALLOWED_FILE_PREFIXES)
    )


def validate_and_extract(package_path, destination):
    if (
        not package_path.is_file()
        or package_path.stat().st_size <= 0
        or package_path.stat().st_size > MAX_PACKAGE_BYTES
    ):
        raise ValueError("Pachetul este gol sau depășește 100 MB.")

    with tarfile.open(package_path, "r:gz") as archive:
        members = archive.getmembers()
        if len(members) > MAX_PACKAGE_FILES:
            raise ValueError("Pachetul conține prea multe fișiere.")
        expanded = 0
        for member in members:
            if not safe_member_name(member.name):
                raise ValueError("Pachetul conține o cale nesigură.")
            if member.issym() or member.islnk() or member.isdev():
                raise ValueError("Pachetul conține legături sau dispozitive interzise.")
            expanded += max(0, member.size)
            if expanded > MAX_EXPANDED_BYTES:
                raise ValueError("Conținutul pachetului depășește limita permisă.")
        archive.extractall(destination, filter="data")

    manifest_path = destination / "mozy-update.json"
    if not manifest_path.is_file():
        raise ValueError("Lipsește manifestul mozy-update.json.")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if manifest.get("format") != "mozy-update-v1":
        raise ValueError("Formatul pachetului nu este acceptat.")
    files = manifest.get("files")
    migrations = manifest.get("migrations", [])
    if not isinstance(files, list) or not files:
        raise ValueError("Manifestul nu conține fișiere de actualizare.")
    if not isinstance(migrations, list):
        raise ValueError("Lista migrărilor nu este validă.")

    expected = {"mozy-update.json"}
    for item in files:
        relative = str(item.get("path", ""))
        if not safe_member_name(relative) or not allowed_payload_path(relative):
            raise ValueError(f"Fișier nepermis în actualizare: {relative}")
        source = destination / "payload" / relative
        if not source.is_file():
            raise ValueError(f"Lipsește fișierul payload/{relative}.")
        if sha256_file(source) != item.get("sha256"):
            raise ValueError(f"Checksum incorect pentru {relative}.")
        expected.add(f"payload/{relative}")

    for item in migrations:
        relative = str(item.get("path", ""))
        if (
            not safe_member_name(relative)
            or not relative.startswith("migrations/")
            or not relative.endswith(".sql")
        ):
            raise ValueError("Migrare SQL nevalidă.")
        source = destination / relative
        if not source.is_file():
            raise ValueError(f"Lipsește migrarea {relative}.")
        if sha256_file(source) != item.get("sha256"):
            raise ValueError(f"Checksum incorect pentru {relative}.")
        expected.add(relative)

    actual = {
        str(path.relative_to(destination))
        for path in destination.rglob("*")
        if path.is_file()
    }
    if actual != expected:
        extras = sorted(actual - expected)
        raise ValueError(
            "Pachetul conține fișiere nedeclarate: " + ", ".join(extras[:5])
        )
    return manifest


def wait_for_health(timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            response = subprocess.run(
                [
                    "curl",
                    "-fsS",
                    "--max-time",
                    "3",
                    "http://127.0.0.1:3005/health",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
            )
            if response.returncode == 0 and b'"status":"ok"' in response.stdout:
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError("CRM-ul nu a devenit healthy după actualizare.")


def restore_files(rollback_dir, files, missing):
    for relative in files:
        target = CRM_DIR / relative
        saved = rollback_dir / relative
        if saved.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(saved, target)
        elif relative in missing:
            target.unlink(missing_ok=True)


def update_worker(job_id, package_path, original_name):
    package = Path(package_path)
    try:
        with operation_lock:
            save_job(
                job_id,
                status="running",
                progress=5,
                message="Se verifică pachetul de actualizare.",
            )
            with tempfile.TemporaryDirectory(
                prefix="mozy-update-",
                dir="/var/tmp",
            ) as temporary:
                temporary_dir = Path(temporary)
                extract_dir = temporary_dir / "extract"
                rollback_dir = temporary_dir / "rollback"
                extract_dir.mkdir()
                rollback_dir.mkdir()
                manifest = validate_and_extract(package, extract_dir)
                version = str(manifest.get("version", "versiune fără nume"))

                save_job(
                    job_id,
                    progress=15,
                    message="Se creează automat backupul complet.",
                )
                backup = create_backup()

                file_paths = [str(item["path"]) for item in manifest["files"]]
                missing = set()
                for relative in file_paths:
                    current = CRM_DIR / relative
                    if current.exists():
                        saved = rollback_dir / relative
                        saved.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(current, saved)
                    else:
                        missing.add(relative)

                try:
                    save_job(
                        job_id,
                        progress=35,
                        message="Se pregătește noua versiune.",
                    )
                    for relative in file_paths:
                        source = extract_dir / "payload" / relative
                        target = CRM_DIR / relative
                        target.parent.mkdir(parents=True, exist_ok=True)
                        temporary_target = target.with_name(f".{target.name}.update")
                        shutil.copy2(source, temporary_target)
                        os.replace(temporary_target, target)

                    run(
                        ["docker", "compose", "config", "--quiet"],
                        cwd=CRM_DIR,
                    )
                    run(
                        ["docker", "compose", "build", "mozy-crm"],
                        cwd=CRM_DIR,
                        timeout=1800,
                    )

                    migrations = manifest.get("migrations", [])
                    if migrations:
                        save_job(
                            job_id,
                            progress=65,
                            message="Se actualizează structura bazei de date.",
                        )
                        sql = b"BEGIN;\n"
                        for item in migrations:
                            sql += (extract_dir / item["path"]).read_bytes()
                            sql += b"\n"
                        sql += b"COMMIT;\n"
                        process = subprocess.run(
                            [
                                "docker",
                                "exec",
                                "-i",
                                "postgres",
                                "sh",
                                "-lc",
                                'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                            ],
                            input=sql,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            check=True,
                            timeout=900,
                        )
                        del process

                    save_job(
                        job_id,
                        progress=80,
                        message="Se repornește CRM-ul și se verifică starea.",
                    )
                    run(
                        [
                            "docker",
                            "compose",
                            "up",
                            "-d",
                            "--force-recreate",
                            "mozy-crm",
                        ],
                        cwd=CRM_DIR,
                        timeout=600,
                    )
                    wait_for_health()
                except Exception:
                    restore_files(rollback_dir, file_paths, missing)
                    run(
                        ["docker", "compose", "build", "mozy-crm"],
                        cwd=CRM_DIR,
                        timeout=1800,
                    )
                    run(
                        [
                            "docker",
                            "compose",
                            "up",
                            "-d",
                            "--force-recreate",
                            "mozy-crm",
                        ],
                        cwd=CRM_DIR,
                        timeout=600,
                    )
                    wait_for_health()
                    raise

        package.unlink(missing_ok=True)
        save_job(
            job_id,
            status="completed",
            progress=100,
            message=f"Actualizarea {version} a fost instalată.",
            result={
                "version": version,
                "package": original_name,
                "backup": backup,
            },
        )
    except Exception as error:
        package.unlink(missing_ok=True)
        save_job(
            job_id,
            status="failed",
            message=f"Actualizarea a eșuat: {error}",
        )


class ThreadingUnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "MozyMaintenance/1.0"

    def log_message(self, format_string, *args):
        print(
            "%s - %s"
            % (self.log_date_time_string(), format_string % args),
            flush=True,
        )

    def json_response(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > 1024 * 1024:
            raise ValueError("Cerere prea mare.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/v1/backups":
            return self.json_response(200, {"backups": list_backups()})

        match = re.fullmatch(r"/v1/jobs/([a-f0-9]{24})", parsed.path)
        if match:
            path = job_path(match.group(1))
            if not path.is_file():
                return self.json_response(404, {"error": "Jobul nu există."})
            return self.json_response(
                200,
                json.loads(path.read_text("utf-8")),
            )

        match = re.fullmatch(
            r"/v1/backups/([^/]+)/download",
            parsed.path,
        )
        if match:
            name = unquote(match.group(1))
            if not BACKUP_RE.fullmatch(name):
                return self.json_response(400, {"error": "Backup invalid."})
            path = BACKUP_DIR / name
            if not path.is_file():
                return self.json_response(404, {"error": "Backup inexistent."})
            self.send_response(200)
            self.send_header("Content-Type", "application/gzip")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{name}"',
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            with open(path, "rb") as source:
                shutil.copyfileobj(source, self.wfile)
            return

        self.json_response(404, {"error": "Rută inexistentă."})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/v1/backups":
            self.read_json()
            job_id = create_job("backup")
            threading.Thread(
                target=backup_worker,
                args=(job_id,),
                daemon=True,
            ).start()
            return self.json_response(202, {"job_id": job_id})

        if parsed.path == "/v1/updates":
            payload = self.read_json()
            package = Path(str(payload.get("path", ""))).resolve()
            original_name = str(payload.get("original_name", ""))
            try:
                package.relative_to(UPLOAD_DIR.resolve())
            except ValueError:
                return self.json_response(
                    400,
                    {"error": "Calea pachetului nu este permisă."},
                )
            if not package.is_file():
                return self.json_response(
                    400,
                    {"error": "Pachetul încărcat nu există."},
                )
            job_id = create_job("update")
            threading.Thread(
                target=update_worker,
                args=(job_id, package, original_name),
                daemon=True,
            ).start()
            return self.json_response(202, {"job_id": job_id})

        self.json_response(404, {"error": "Rută inexistentă."})


def main():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOCKET_PATH.exists() or SOCKET_PATH.is_socket():
        SOCKET_PATH.unlink()
    with ThreadingUnixServer(str(SOCKET_PATH), Handler) as server:
        os.chmod(SOCKET_PATH, 0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
