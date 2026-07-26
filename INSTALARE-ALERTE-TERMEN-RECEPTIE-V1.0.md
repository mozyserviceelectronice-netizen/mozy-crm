# Alerte termen recepție atelier v1.0.0

Funcționalități:

- alerte interne WhatsApp în zilele 3, 5, 6 și 7 de la `data_primire`;
- termenul nu se resetează la schimbarea statusului;
- exclude statusurile `finalizat`, `predat` și `anulat`;
- alertă unică pentru fiecare prag;
- buton individual pentru oprirea și reactivarea alertelor;
- destinatar implicit: `40799269589`;
- verificare la pornirea aplicației și apoi o dată pe oră.

Migrarea este idempotentă.
