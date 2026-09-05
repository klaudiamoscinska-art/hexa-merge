# Hexa Merge & Multiply: The Splitter

Neonowa gra logiczno-zręcznościowa z fizyką (Plinko/Pachinko + 2048-style merge),
w stylistyce cyberpunkowej (czarne tło, neonowe poświaty: Cyan `#00f3ff`,
Hot Pink `#ff007f`, Purple `#bd00ff`). Statyczna strona, bez build stepu —
gotowa do wrzucenia na GitHub Pages.

## Struktura plików

- `index.html` — struktura DOM: nagłówek, panele HUD (wynik/rekord/złoto),
  `<canvas id="gameCanvas">`, overlaye (start / game over), sklep ulepszeń.
- `style.css` — cyberpunkowy arkusz stylów, w pełni responsywny (canvas
  skaluje się przez `aspect-ratio` w CSS + `devicePixelRatio` w JS).
- `game.js` — cała logika gry, czysty JS (bez frameworków/bibliotek), OOP:
  klasy `Game`, `Block`, `Gate`, `Peg`, `Particle`.

Brak builda, bundlera, zależności npm — otwierasz `index.html` i działa.

## Mechanika (skrót)

- Gracz porusza myszką/palcem nad planszą i klika, żeby zrzucić heksagonalny
  klocek z liczbą będącą potęgą dwójki (2, 4, 8, ...).
- Klocek spada pod grawitacją, odbija się od kołków (Peg), przechodzi przez
  bramki laserowe (Gate: `x2`, `+16`, `SPLIT` — jedna z nich się porusza).
- Na dole klocki się zatrzymują (`Block.settled`); dwa stykające się klocki
  o tej samej wartości scalają się (`Game.mergeBlocks`) w jeden o sumie
  wartości, z efektem cząsteczkowym (shockwave) odpychającym sąsiadów.
- Przegrana: jeśli osiadły klocek trwale sięga ponad linię ostrzegawczą
  (`Game.warningY`), gra się kończy (`Game.gameOver`).
- Wynik/rekord/złoto trzymane w `localStorage` (`hexaMerge.*`), sklep
  pozwala podnieść startową wartość klocka (2 → 4 → 8) za złoto.
- Ekran Game Over: `Restart` oraz `Zatrzymaj i Wyczyść Dół Planszy` — ten
  drugi to obecnie placeholder (czyści dolną część planszy i wznawia grę),
  docelowo ma być podpięty pod Rewarded Ad (AdMob / CrazyGames SDK).

## Fizyka — pułapki, na które trzeba uważać

Fizyka jest własna (bez biblioteki), pozycyjno-impulsowa, rozwiązywana
"na sztywno" co klatkę (bez iteracyjnego solvera). To rodzi realne pułapki,
z którymi już się mierzyliśmy — jeśli zmieniasz layout kołków/bramek albo
zakresy promieni klocków, przetestuj pod kątem tych dwóch klas błędów:

1. **Klocek utyka na stałe** w geometrycznie niemożliwej szczelinie
   (np. kołek za blisko ściany względem promienia najmniejszego klocka).
   Zabezpieczenie: margines kołków od ścian w `Game.buildPegs` oraz
   wykrywacz "utknięcia" w `Block.update` (`STUCK_SPEED`/`STUCK_TIME`),
   który fizycznie przesuwa klocek za przeszkodę.
2. **Klocek zawieszony w powietrzu** po tym, jak scalenie usunęło blok,
   na którym się opierał (`settled=true`, ale bez podparcia).
   Zabezpieczenie: `Game.checkSupport()`, wywoływane co klatkę po
   `checkMerges()` — odsettla klocki bez podparcia, żeby znów spadały.

Jeśli dodajesz nowe mechaniki wpływające na pozycję/prędkość klocków,
sprawdź scenariusz: dużo klocków naraz, długi czas gry bez interakcji
(patrz sekcja Testowanie) — łatwo o regresję w którymś z powyższych.

## Testowanie

Brak frameworka testowego. Weryfikacja robiona ręcznie/Playwright w
headless Chromium: lokalny `python3 -m http.server`, symulacja kliknięć
myszką po canvasie, zrzuty ekranu do oceny wizualnej i odczyt
`#scoreValue`/`#goldValue`/klas overlayów do weryfikacji stanu gry.
Przy większych zmianach w fizyce lub layoutcie planszy warto powtórzyć
taki test (dłuższa sesja + brak interakcji przez kilka sekund), żeby
złapać "zawieszone" klocki zanim trafią na produkcję.

## Konwencje

- Brak zależności zewnętrznych poza Google Fonts (Orbitron, Rajdhani)
  ładowanym przez `<link>` w `index.html`.
- Kod bez komentarzy opisujących "co" — tylko tam, gdzie nieoczywiste
  "dlaczego" (patrz `checkSupport`, wykrywacz utknięcia w `Block.update`).
- Kolory/wartości progowe fizyki są stałymi na górze `game.js`
  (`GRAVITY`, `*_RESTITUTION`, `SETTLE_VEL`, `STUCK_*`, `MERGE_TOLERANCE`) —
  zmieniaj je tam, nie rozrzucaj magicznych liczb w kodzie.
