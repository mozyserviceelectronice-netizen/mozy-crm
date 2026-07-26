# Biblioteca defecte — puncte de extensie pentru Etapa 2

## Legătura cu fișele de service

Modulul este separat în:

- `src/defect-library-domain.js`: normalizare, validare, allowlist-uri și
  construirea URL-urilor;
- `src/defect-library-files.js`: validarea și stocarea securizată a
  atașamentelor;
- `src/defect-library-routes.js`: interogările și operațiile bibliotecii.

Pentru acțiunea viitoare „Caută caz similar în bibliotecă”, extragerea
parametrizată a căutării trebuie mutată într-o funcție exportată care primește
termenii derivați din fișa de service: marcă, model, simptom și coduri tehnice.
Fișa va apela această funcție numai după autentificare și va afișa rezultate
existente; nu este necesară duplicarea tabelelor sau a indexurilor.

Pentru „Salvează această reparație în bibliotecă”, fluxul recomandat este:

1. precompletarea formularului `/biblioteca-defecte/cazuri/nou` cu datele
   fișei;
2. confirmarea și completarea manuală de către tehnician;
3. salvarea prin serviciul existent de normalizare/deduplicare;
4. copierea controlată a fotografiilor numai după confirmare, cu audit și
   hash nou.

Nu se recomandă inserarea automată directă din fișă: biblioteca trebuie să
rămână o bază de cunoștințe curată, nu o copie a tuturor reparațiilor.

## Surse externe

Etapa 2 poate adăuga separat:

- căutare Google și pe forumuri tehnice;
- listă administrabilă de surse permise;
- import manual al unei pagini selectate;
- rezumare AI cu citarea URL-ului și data accesării;
- căutare de datasheet-uri;
- flux separat pentru firmware, dump-uri și arhive.

Înainte de implementare trebuie stabilite:

- sursele permise și condițiile lor de utilizare;
- politica de copyright și păstrarea fragmentelor;
- scanarea antivirus și sandboxing-ul pentru tipurile binare noi;
- limitele de stocare;
- faptul că rezultatele externe sunt marcate „neverificat” până la confirmarea
  în service.

Nu trebuie expus public niciun atașament intern și nu trebuie reutilizată ruta
statică pentru fișiere.
