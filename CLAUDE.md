# AURORA — zasady projektu

## Żelazna zasada: każda aktualizacja ma okno „Co nowego”

Każda zmiana, którą zespół zobaczy w panelu, wychodzi jako nowa wersja z opisem:

1. Podnieś `version` w `package.json` (semver: nowa funkcja → minor, poprawka → patch).
2. Dopisz wpis **na górze** `src/releases.json`: `version` (ta sama co w package.json), `date`, `icon`, `title`, `lead`, `items` (co zmieniono i co poprawiono, prostym językiem, po polsku).
3. **Zawsze rysuj nową ikonę** w `src/brand/ReleaseIcons.tsx`, która metaforycznie pokazuje, co się zmieniło (np. 0.2.0: holding rozgałęzia się na marki i produkty). Tylko czerń, biel i `#FDADA4`, pełne wypełnienia, bez cieni i gradientów.

Okno (`src/app/WhatsNew.tsx`) pokazuje się raz, przy pierwszym wejściu do panelu po aktualizacji (`profiles.seen_version`). Pierwszej strony nie da się zamknąć przez 5 sekund. Kilka pominiętych wersji sumuje się w jedno okno (strony od najnowszej): blokada 5 s dotyczy tylko pierwszej, kolejne można zamknąć od razu. Historia jest w menu użytkownika: „Co nowego · vX.Y.Z”.

`vite.config.ts` przerywa build, jeśli wersja w package.json nie zgadza się z najnowszym wpisem w `src/releases.json` albo wpis nie ma ikony.

## Struktura wiedzy

Firma (holding, np. GREYWOLF GROUP) → marki (`brands`, w klastrach) → produkty. Wpis bez produktu należy do marki, wpis bez marki — do całej grupy. Wpis z produktem dziedziczy markę produktu (trigger `entries_brand`). Każdy fakt z poczty, importu i Claude jest przypisywany do marki osobno (`_shared/ingest.ts`), podpowiedź nadawcy to tylko podpowiedź.

## Inne

- Interfejs tylko po polsku. Animacja na każde działanie. Bez napisów-plakietek nad nagłówkami.
- Commit i push robi właściciel projektu.
