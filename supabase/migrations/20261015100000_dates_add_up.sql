-- Terminy się sumują: inny dzień tego samego produktu to kolejna edycja, nie konflikt.
-- Czekające „konflikty” dat, które tylko różnią się dniem od wpisu w bazie, stają się zwykłymi nowymi wpisami
-- (po zatwierdzeniu dopiszą się obok, niczego nie zastąpią). Dotyczy wszystkich firm.
update proposals p
set kind = 'new',
    entry_id = null,
    evidence = nullif(trim(regexp_replace(coalesce(p.evidence, ''), '^sprzeczne z wpisem w bazie\.?\s*', '')), '')
from entries e
where e.id = p.entry_id
  and p.status = 'pending'
  and p.kind = 'conflict'
  and p.payload->>'type' = 'date'
  and e.type = 'date'
  and p.payload->>'effective_from' is not null
  and e.effective_from is not null
  and (p.payload->>'effective_from')::date <> e.effective_from;
