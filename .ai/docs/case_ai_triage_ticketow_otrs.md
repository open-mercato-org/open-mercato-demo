# AI Triage ticketów OTRS

## Cel

Celem rozwiązania jest wykorzystanie AI do automatycznego wstępnego przetwarzania i klasyfikacji ticketów przychodzących od klientów w systemie OTRS.

Agent AI powinien przed rozpoczęciem pracy przez konsultanta zebrać dostępny kontekst dotyczący klienta i jego rezerwacji, zinterpretować treść wiadomości oraz przygotować informacje i rekomendacje pozwalające konsultantowi szybciej podjąć właściwe działania.

Docelowo rozwiązanie powinno ograniczyć czas poświęcany przez pracownika na:
- identyfikację klienta i rezerwacji,
- przechodzenie pomiędzy kilkoma systemami,
- analizę treści wiadomości,
- ustalanie priorytetu sprawy,
- wyszukiwanie instrukcji postępowania,
- przygotowanie odpowiedzi na standardowe zapytania.

Agent pełni przede wszystkim rolę **warstwy triage i wsparcia konsultanta**. W przypadkach wymagających decyzji człowieka powinien jednoznacznie przekazać sprawę do ręcznej weryfikacji.

## Systemy i źródła danych

Rozwiązanie powinno wykorzystywać informacje dostępne w trzech głównych systemach:

**CRM**

Customowy system zawierający między innymi:
- profile klientów,
- rezerwacje klientów,
- status i szczegóły rezerwacji,
- informacje dotyczące płatności,
- historię kontaktu i korespondencji,
- inne informacje związane z obsługą rezerwacji.

**OTRS**

System ticketowy, do którego trafiają wiadomości e-mail od klientów. Każda wiadomość lub ciąg wiadomości obsługiwany jest w postaci ticketu.

**Baza Wiedzy**

Źródło wiedzy dotyczącej procesów obsługowych. Wiedza posiada określoną strukturę biznesową, np.:

**kategoria → subkategoria → temat**

Baza Wiedzy może być wykorzystywana przez agenta do identyfikacji właściwego procesu oraz sugerowania konsultantowi kolejnych działań.

---

## Ogólny przebieg triage

### 1. Identyfikacja klienta i rezerwacji

Pierwszym krokiem powinno być określenie, którego klienta i której rezerwacji dotyczy wiadomość.

Jeżeli w wiadomości znajduje się **numer rezerwacji**, agent:

1. identyfikuje numer rezerwacji,
2. sprawdza w CRM, czy rezerwacja jest powiązana z klientem korzystającym z adresu e-mail, z którego została wysłana wiadomość,
3. jeżeli dane są zgodne, pobiera z CRM informacje istotne dla dalszej interpretacji ticketu,
4. jeżeli danych nie można jednoznacznie potwierdzić, odpowiednio oznacza ticket do dalszej weryfikacji.

Jeżeli wiadomość **nie zawiera numeru rezerwacji**, agent wyszukuje klienta na podstawie adresu e-mail.

Jeżeli do klienta przypisana jest:

- **jedna rezerwacja** – może ona zostać potraktowana jako najbardziej prawdopodobny kontekst wiadomości;
- **więcej niż jedna rezerwacja** – agent powinien spróbować określić właściwą rezerwację na podstawie treści wiadomości i dostępnych danych, np. kierunku podróży, terminu, hotelu lub innych informacji zawartych w korespondencji;
- **brak rezerwacji lub brak możliwości jednoznacznego określenia rezerwacji** – agent powinien wyraźnie wskazać brak pewności i skierować sprawę do odpowiedniej weryfikacji.

Agent nie powinien ukrywać niepewności. Jeżeli kontekstu nie można ustalić w sposób wystarczająco wiarygodny, powinno to być widoczne dla konsultanta.

---

## 2. Analiza i klasyfikacja ticketu

Po zidentyfikowaniu możliwego kontekstu klienta agent analizuje treść wiadomości i uzupełnia podstawowe informacje pozwalające na dalszą obsługę.

Przykładowe elementy triage:

- **kategoria sprawy,**
- **subkategoria / temat,**
- **priorytet,**
- **powiązana rezerwacja,**
- **krótkie podsumowanie wiadomości,**
- **sugerowane dalsze działanie,**
- **informacja, czy sprawa może zostać częściowo obsłużona automatycznie,**
- **informacja, czy wymagana jest ręczna weryfikacja.**

### Krótkie podsumowanie

Agent powinien przygotować jedno- lub kilkuzdaniowe streszczenie sprawy, które będzie widoczne bez konieczności otwierania całego ticketu.

Przykład:

> Klient prosi o zwrot nadpłaty z rezerwacji XXXXXXXX i przekazuje numer rachunku bankowego.

Dzięki temu konsultant może szybko zorientować się, czego dotyczy ticket.

### Priorytet

Priorytet może być ustalany na podstawie zarówno treści wiadomości, jak i danych z CRM.

Jednym z istotnych czynników może być **czas pozostały do rozpoczęcia podróży** – sprawy dotyczące klientów z bardzo bliskim terminem wylotu powinny otrzymywać wyższy priorytet niż analogiczne sprawy dotyczące podróży odbywającej się za kilka miesięcy.

Priorytet może również uwzględniać charakter sprawy.

---

## 3. Rekomendacja kolejnego działania

Na podstawie kategorii sprawy, informacji z CRM oraz Bazy Wiedzy agent może zaproponować konsultantowi kolejne kroki.

Przykładowo:

- sprawdź określony parametr rezerwacji,
- zweryfikuj płatność,
- skontaktuj się z określonym działem,
- wykonaj określoną akcję w CRM,
- poproś klienta o dodatkowe informacje,
- przekaż sprawę do ręcznej weryfikacji.

Rekomendacje powinny być możliwie konkretne i wynikać z obowiązujących procesów zawartych w Bazie Wiedzy.

W wybranych, dobrze zdefiniowanych procesach agent może również proponować konsultantowi **gotową akcję do wykonania**, np.:

**„Zleć zwrot”**

Akcja nie musi być wykonywana automatycznie. Konsultant może ją świadomie zatwierdzić.

---

## 4. Przygotowanie draftu odpowiedzi

W sprawach, dla których dostępny kontekst oraz proces są wystarczająco jednoznaczne, agent powinien przygotować propozycję odpowiedzi dla klienta.

Draft powinien wykorzystywać:
- treść wiadomości klienta,
- informacje dotyczące klienta i rezerwacji,
- wynik wykonanych przez agenta weryfikacji,
- informacje z Bazy Wiedzy.

Konsultant powinien móc:
- przeczytać odpowiedź,
- zmodyfikować ją,
- zaakceptować,
- wysłać.

W bardziej złożonych lub niejednoznacznych przypadkach agent nie powinien próbować generować pozornie kompletnej odpowiedzi, lecz wskazać konieczność ręcznej obsługi.

---

# Przykładowe scenariusze

## Przykład 1 – zwrot nadpłaty

Klient przesyła wiadomość z prośbą o zwrot nadpłaty i podaje numer rachunku bankowego.

Agent:

1. identyfikuje klienta i rezerwację,
2. weryfikuje dostępne informacje dotyczące rezerwacji,
3. klasyfikuje ticket jako sprawę dotyczącą zwrotu,
4. przygotowuje krótkie podsumowanie sprawy,
5. proponuje odpowiednią akcję, np. **„Zleć zwrot”**,
6. przygotowuje draft odpowiedzi dla klienta.

Konsultant weryfikuje dane i zatwierdza akcję oraz odpowiedź.

---

## Przykład 2 – potwierdzenie płatności

Klient przesyła potwierdzenie wykonania płatności.

Agent:

1. identyfikuje klienta i rezerwację,
2. sprawdza w CRM aktualny status płatności.

Jeżeli wpłata jest już widoczna:

- agent oznacza odpowiedni status sprawy,
- przygotowuje draft odpowiedzi potwierdzającej jej zaksięgowanie.

Jeżeli wpłata nie jest widoczna:

- agent informuje konsultanta o rozbieżności,
- ticket zostaje oznaczony jako wymagający ręcznej weryfikacji.

---

## Przykład 3 – życzenie dotyczące pokoju

Klient informuje, że chciałby otrzymać pokój znajdujący się w cichej części hotelu.

Agent:

1. identyfikuje klienta i rezerwację,
2. rozpoznaje charakter wiadomości,
3. przypisuje odpowiednią kategorię,
4. przygotowuje krótkie podsumowanie,
5. oznacza sprawę jako wymagającą dalszej obsługi przez konsultanta.

Agent nie podejmuje samodzielnej decyzji dotyczącej realizacji życzenia.

---

## Przykład 4 – reklamacja

Klient zgłasza reklamację dotyczącą usługi.

Agent:

1. identyfikuje klienta i rezerwację,
2. rozpoznaje wiadomość jako reklamację,
3. odpowiednio klasyfikuje ticket,
4. przygotowuje krótkie podsumowanie,
5. kieruje ticket do ręcznej weryfikacji zgodnie z właściwym procesem.

W tym przypadku rolą AI jest przede wszystkim prawidłowe rozpoznanie, wzbogacenie i przekierowanie sprawy, a nie jej automatyczne rozstrzygnięcie.

---

# Docelowy rezultat triage

Po wykonaniu triage konsultant otwierający kolejkę OTRS powinien od razu widzieć najważniejsze informacje dotyczące sprawy, np.:

**Klient:** zidentyfikowany  
**Rezerwacja:** XXXXXXXX  
**Kategoria:** Płatności / Zwroty  
**Priorytet:** wysoki – wylot za 3 dni  
**Opis:** Klient prosi o zwrot nadpłaty i przekazuje numer rachunku bankowego.  
**Rekomendowana akcja:** zweryfikuj nadpłatę i zleć zwrot  
**Status AI:** możliwa obsługa wspomagana  
**Draft odpowiedzi:** przygotowany

W innych przypadkach agent może wyświetlić np.:

**Status AI:** wymagana ręczna weryfikacja  
**Powód:** nie udało się jednoznacznie określić rezerwacji, której dotyczy wiadomość.

---

# Zasady działania rozwiązania

Kluczowe jest, aby rozwiązanie działało według kilku zasad:

**AI wspiera pracownika, ale nie ukrywa niepewności.**  
Jeżeli agent nie jest w stanie wiarygodnie ustalić kontekstu lub właściwej akcji, powinien jednoznacznie to zaznaczyć.

**Zakres automatyzacji zależy od rodzaju sprawy.**  
Proste i jednoznaczne procesy mogą być mocniej zautomatyzowane. Sprawy wymagające interpretacji, decyzji biznesowej lub indywidualnego podejścia powinny trafiać do człowieka.

**Agent korzysta z pełnego dostępnego kontekstu.**  
Interpretacja samej treści e-maila jest niewystarczająca. Wartość rozwiązania wynika z połączenia informacji z OTRS, CRM i Bazy Wiedzy.

**Akcje wpływające na klienta lub rezerwację mogą wymagać akceptacji pracownika.**  
AI może przygotować akcję lub rekomendację, natomiast jej wykonanie może pozostać po stronie konsultanta.

**Triage powinien skracać drogę od otrzymania wiadomości do podjęcia działania.**  
Docelowo pracownik powinien otrzymywać nie tylko zaklasyfikowany ticket, ale również zgromadzony kontekst, rekomendowany następny krok oraz – tam, gdzie jest to możliwe – gotowy draft odpowiedzi.

---

# Oczekiwana wartość biznesowa

Rozwiązanie powinno prowadzić przede wszystkim do:

- skrócenia czasu obsługi ticketów,
- ograniczenia liczby manualnych przejść pomiędzy OTRS, CRM i Bazą Wiedzy,
- szybszej identyfikacji pilnych spraw,
- bardziej spójnej klasyfikacji ticketów,
- zmniejszenia liczby czynności wykonywanych manualnie przez konsultanta,
- szybszego przygotowywania odpowiedzi,
- lepszego wykorzystania wiedzy procesowej dostępnej w organizacji,
- umożliwienia dalszej automatyzacji wybranych, powtarzalnych procesów.

Docelowo AI powinno działać jako **pierwsza warstwa obsługi każdego przychodzącego ticketu**, przygotowując sprawę w taki sposób, aby konsultant mógł możliwie szybko przejść od analizy do podjęcia właściwego działania.