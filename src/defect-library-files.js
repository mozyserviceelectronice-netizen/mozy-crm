import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import {
  detectLibraryFileType,
  libraryExtensionMatches,
  safeLibraryFileName
} from './defect-library-domain.js';

export const libraryStorageRoot = path.resolve(
  String(
    process.env.DEFECT_LIBRARY_DIR ||
      '/app/data/biblioteca-defecte'
  )
);

export const libraryUploadLimits = Object.freeze({
  imageBytes: Number(
    process.env.DEFECT_LIBRARY_IMAGE_MAX_BYTES ||
      15 * 1024 * 1024
  ),
  pdfBytes: Number(
    process.env.DEFECT_LIBRARY_PDF_MAX_BYTES ||
      40 * 1024 * 1024
  ),
  filesPerCase: Number(
    process.env.DEFECT_LIBRARY_MAX_FILES || 20
  ),
  caseBytes: Number(
    process.env.DEFECT_LIBRARY_CASE_MAX_BYTES ||
      200 * 1024 * 1024
  )
});

function uploadError(message, status = 400, code = 'upload_invalid') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function validatedLimits() {
  const limits = libraryUploadLimits;
  if (
    !Number.isInteger(limits.imageBytes) ||
    limits.imageBytes < 1024 ||
    limits.imageBytes > 15 * 1024 * 1024 ||
    !Number.isInteger(limits.pdfBytes) ||
    limits.pdfBytes < 1024 ||
    limits.pdfBytes > 40 * 1024 * 1024 ||
    !Number.isInteger(limits.filesPerCase) ||
    limits.filesPerCase < 1 ||
    limits.filesPerCase > 20 ||
    !Number.isInteger(limits.caseBytes) ||
    limits.caseBytes < limits.pdfBytes ||
    limits.caseBytes > 200 * 1024 * 1024
  ) {
    throw new Error('Limitele Bibliotecii defecte nu sunt valide.');
  }
  return limits;
}

export function resolveLibraryStoredPath(relativePath) {
  const candidate = String(relativePath || '');
  if (
    !/^[0-9]{4}\/caz-[0-9]+\/(?:thumb-)?[a-f0-9-]+\.(?:jpg|png|webp|pdf)$/.test(
      candidate
    )
  ) {
    return null;
  }
  const resolved = path.resolve(libraryStorageRoot, candidate);
  const prefix = `${libraryStorageRoot}${path.sep}`;
  return resolved.startsWith(prefix) ? resolved : null;
}

export async function receiveLibraryUpload(req) {
  const limits = validatedLimits();
  const originalName = safeLibraryFileName(req.get('X-File-Name'));
  if (!originalName) {
    throw uploadError('Numele fișierului nu este valid.');
  }

  const declaredBytes = Number(req.get('Content-Length') || 0);
  const absoluteMax = Math.max(
    limits.imageBytes,
    limits.pdfBytes
  );
  if (
    !Number.isInteger(declaredBytes) ||
    declaredBytes <= 0 ||
    declaredBytes > absoluteMax
  ) {
    throw uploadError(
      'Fișierul este gol sau depășește limita maximă permisă.',
      413,
      'upload_size'
    );
  }

  const temporaryDirectory = path.join(libraryStorageRoot, '.tmp');
  await fsp.mkdir(temporaryDirectory, {
    recursive: true,
    mode: 0o700
  });
  const temporaryPath = path.join(
    temporaryDirectory,
    `${crypto.randomUUID()}.partial`
  );
  const hash = crypto.createHash('sha256');
  let receivedBytes = 0;
  let header = Buffer.alloc(0);

  const inspector = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > absoluteMax) {
        callback(uploadError(
          'Fișierul depășește limita maximă permisă.',
          413,
          'upload_size'
        ));
        return;
      }
      if (header.length < 32) {
        header = Buffer.concat([
          header,
          chunk.subarray(0, 32 - header.length)
        ]);
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  const output = fs.createWriteStream(temporaryPath, {
    flags: 'wx',
    mode: 0o600
  });

  try {
    await pipeline(req, inspector, output);
    if (
      receivedBytes !== declaredBytes ||
      receivedBytes <= 0
    ) {
      throw uploadError('Fișierul a fost încărcat incomplet.');
    }

    const detected = detectLibraryFileType(header);
    if (!detected) {
      throw uploadError(
        'Sunt acceptate numai fișiere JPEG, PNG, WebP și PDF.',
        415,
        'upload_type'
      );
    }
    if (!libraryExtensionMatches(originalName, detected)) {
      throw uploadError(
        'Extensia fișierului nu corespunde conținutului real.',
        415,
        'upload_extension'
      );
    }

    const declaredMime = String(
      req.get('Content-Type') || ''
    ).split(';')[0].trim().toLowerCase();
    if (
      declaredMime &&
      declaredMime !== 'application/octet-stream' &&
      declaredMime !== detected.mime
    ) {
      throw uploadError(
        'Tipul declarat nu corespunde conținutului real.',
        415,
        'upload_mime'
      );
    }

    const typeLimit = detected.kind === 'pdf'
      ? limits.pdfBytes
      : limits.imageBytes;
    if (receivedBytes > typeLimit) {
      throw uploadError(
        detected.kind === 'pdf'
          ? 'PDF-ul depășește limita de 40 MB.'
          : 'Imaginea depășește limita de 15 MB.',
        413,
        'upload_size'
      );
    }

    if (detected.kind === 'imagine') {
      const metadata = await sharp(temporaryPath, {
        failOn: 'error',
        limitInputPixels: 120_000_000
      }).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width > 20000 ||
        metadata.height > 20000
      ) {
        throw uploadError(
          'Imaginea nu poate fi validată în siguranță.',
          415,
          'upload_image'
        );
      }
    }

    let description = '';
    try {
      description = decodeURIComponent(
        String(req.get('X-File-Description') || '')
      );
    } catch {
      description = '';
    }

    return {
      temporaryPath,
      originalName,
      detected,
      size: receivedBytes,
      sha256: hash.digest('hex'),
      description: description
        .normalize('NFKC')
        .trim()
        .slice(0, 300),
      limits
    };
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function finalizeLibraryUpload({
  upload,
  caseId
}) {
  const year = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric'
  }).format(new Date());
  const token = crypto.randomUUID();
  const relativeDirectory = `${year}/caz-${caseId}`;
  const relativePath =
    `${relativeDirectory}/${token}${upload.detected.extension}`;
  const finalPath = resolveLibraryStoredPath(relativePath);
  const thumbnailRelativePath = upload.detected.kind === 'imagine'
    ? `${relativeDirectory}/thumb-${token}.webp`
    : null;
  const thumbnailPath = thumbnailRelativePath
    ? resolveLibraryStoredPath(thumbnailRelativePath)
    : null;

  if (!finalPath || (thumbnailRelativePath && !thumbnailPath)) {
    throw uploadError('Calea internă a fișierului nu este validă.');
  }

  await fsp.mkdir(path.dirname(finalPath), {
    recursive: true,
    mode: 0o750
  });
  await fsp.rename(upload.temporaryPath, finalPath);

  try {
    if (thumbnailPath) {
      await sharp(finalPath, {
        failOn: 'error',
        limitInputPixels: 120_000_000
      })
        .rotate()
        .resize({
          width: 480,
          height: 360,
          fit: 'inside',
          withoutEnlargement: true
        })
        .webp({ quality: 78 })
        .toFile(thumbnailPath);
      await fsp.chmod(thumbnailPath, 0o600);
    }
    await fsp.chmod(finalPath, 0o600);
    return {
      relativePath,
      thumbnailRelativePath,
      finalPath,
      thumbnailPath
    };
  } catch (error) {
    await Promise.all([
      fsp.rm(finalPath, { force: true }).catch(() => {}),
      thumbnailPath
        ? fsp.rm(thumbnailPath, { force: true }).catch(() => {})
        : Promise.resolve()
    ]);
    throw error;
  }
}

export async function cleanupLibraryUpload(upload, finalized = null) {
  const candidates = [
    upload?.temporaryPath,
    finalized?.finalPath,
    finalized?.thumbnailPath
  ].filter(Boolean);
  await Promise.all(
    candidates.map(candidate =>
      fsp.rm(candidate, { force: true }).catch(() => {})
    )
  );
}

export function libraryContentDisposition(mode, fileName) {
  const safeMode = mode === 'attachment' ? 'attachment' : 'inline';
  const ascii = String(fileName || 'fisier')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 180) || 'fisier';
  const encoded = encodeURIComponent(String(fileName || 'fisier'))
    .replace(/['()*]/g, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
  return `${safeMode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
