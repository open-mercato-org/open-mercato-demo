# Scenariusz dema Agent Orchestratora — Acme 1 + Acme 2

Scenariusz: „zwrot nadpłaty z multi-source kontekstem”. Pokrywa Acme 1 i Acme 2 — kilka źródeł wiedzy, zadanie, human approval, śledzenie flow.

## Setup

Orchestrator z trzema źródłami podpiętymi jako knowledge — CRM/mock klienta i rezerwacji, ticket OTRS/skrzynka mailowa, Baza Wiedzy/dokumenty procesów. Włączony widok przebiegu: kroki, tool calls, statusy. Dane testowe: mail „proszę o zwrot nadpłaty z rezerwacji ABC123, rachunek PL…”, wylot za trzy dni.

## Kroki

### Krok 1 — start

Nowy ticket/trigger w kolejce. Agent nie zgaduje z samego tekstu — najpierw zbiera kontekst z kilku źródeł, potem robi zadanie, na końcu człowiek zatwierdza.

### Krok 2 — multi-source

Równoległe/sekwencyjne odczyty CRM, ticketu, Bazy Wiedzy; w trace widać każdy call. To jest wspólny mianownik — wiedza z wielu źródeł jako kontekst.

### Krok 3 — identyfikacja i klasyfikacja

Klient OK, rezerwacja ABC123, kategoria Płatności/Zwroty, priorytet wysoki bo wylot za trzy dni, short summary. Agent wzbogaca sprawę zanim konsultant otworzy ticket; niepewność jawnie oznaczona.

### Krok 4 — execution z knowledge

Rekomendacja „zweryfikuj nadpłatę i zleć zwrot” plus draft odpowiedzi, oparte o proces z Bazy Wiedzy. Agent wykonał zadanie na zebranym kontekście.

### Krok 5 — human approval

Karta do akceptacji — zatwierdź akcję, edytuj draft, wyślij albo odrzuć. Żadna akcja na kliencie bez człowieka.

### Krok 6 — flow tracking

Pełny przebieg od źródeł przez decyzje do approval, z możliwością replay. Testujecie przepływ i śledzenie — jak Orchestrator układa kroki i jak podpiąć warstwę wiedzy albo LangGraph/DeepAgents jako kolejne nody.

## Zamknięcie

Ten sam szkielet działa dla Acme 1 na ich dokumentach i agentach, i dla Acme 2 na CRM+OTRS+KB. Różnica to tylko źródła i treść procesu — orchestracja, approval i trace zostają.
