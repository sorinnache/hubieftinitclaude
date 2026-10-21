# Hub IEFTINIT — Retururi & Service: instalare pe Railway

Ai nevoie de 3 lucruri: arhiva `hub-ieftinit.zip`, fișierul `variabile-railway.txt` și exportul `hub_retururi_service_2026-10-21.json`.

---

## Partea 1 — Pune aplicația pe Railway (o singură dată, ~15 minute)

**1. Dezarhivează proiectul.**
Dă dublu-click pe `hub-ieftinit.zip` din Downloads. Apare folderul `hub-ieftinit`.

**2. Instalează Railway CLI.**
Deschide aplicația **Terminal** pe Mac (Cmd + Space, scrii „Terminal”, Enter) și lipește:

```
bash <(curl -fsSL cli.new)
```

**3. Loghează-te în Railway.**
Tot în Terminal:

```
railway login
```

Se deschide browserul. Confirmă logarea și revino în Terminal.

**4. Creează proiectul și trimite codul.**
Lipește în Terminal, rând cu rând:

```
cd ~/Downloads/hub-ieftinit
railway init --name hub-ieftinit
railway up --detach
```

Prima construire durează 3–5 minute.

**5. Adaugă baza de date MongoDB.**
Mergi pe [railway.com](https://railway.com) → proiectul **hub-ieftinit**. Apasă **+ Create** → **Database** → **MongoDB**.

**6. Adaugă discul pentru poze (Volume).**
În proiect, click dreapta pe serviciul aplicației (cel cu numele `hub-ieftinit`). Alege **Attach Volume** și pune **Mount path** = `/data`.

**7. Pune variabilele.**
Click pe serviciul aplicației → tab-ul **Variables** → **Raw Editor**. Lipește tot conținutul din `variabile-railway.txt` și apasă **Update Variables**. Aplicația repornește singură.

**8. Generează un link de test.**
În serviciul aplicației: **Settings** → **Networking** → **Generate Domain**. Primești un link de tip `hub-ieftinit-production.up.railway.app`.

**9. Loghează-te.**
Deschide linkul de la pasul 8 și intră cu:
- email: `admin@ieftinit.ro`
- parola: valoarea `ADMIN_PASSWORD` din `variabile-railway.txt`

După prima logare, schimbă parola din **Setări → Contul meu**.

---

## Partea 2 — Importă istoricul (~2 minute)

**1.** În hub-ul nou, mergi la **Setări → Import date**.

**2.** Apasă **Alege fișierul și importă**. Selectează `hub_retururi_service_2026-10-21.json`.

**3.** Așteaptă să apară **Import finalizat**. Trebuie să vezi: Retururi 79, Service 14, Fișiere 73.

**4.** Verifică în **Setări → Integrări** că GLS și adresa depozitului au bifă verde.

Dacă Shopify nu are bifă verde la acest pas, e normal. Se conectează în Partea 3, după mutarea domeniului.

---

## Partea 3 — Ziua mutării (când ești gata să renunți la Emergent)

**1. Fă un export proaspăt din hub-ul vechi.**
Deschide hub.ieftinit.ro (cel vechi) în Chrome, loghează-te și apasă **Cmd + Option + J**. Lipește scriptul de export (cel folosit pe 21.10) și apasă Enter. Se descarcă un fișier `.json` nou.

**2. Importă-l în hub-ul nou cu suprascriere.**
În hub-ul nou: **Setări → Import date**. Bifează **Suprascrie cererile care există deja** și încarcă fișierul nou. Așa intră și retururile apărute între timp, plus statusurile schimbate în vechiul hub.

**3. Leagă domeniul hub.ieftinit.ro de Railway.**
- În Railway: serviciul aplicației → **Settings** → **Networking** → **Custom Domain**. Scrie `hub.ieftinit.ro`.
- Railway îți arată o înregistrare **CNAME**, de forma `xxxx.up.railway.app`.
- Mergi unde ai DNS-ul pentru ieftinit.ro (de exemplu Cloudflare, ROTLD sau firma de hosting). La înregistrarea `hub`, înlocuiește valoarea veche (Emergent) cu valoarea CNAME de la Railway.
- În 5–30 de minute, hub.ieftinit.ro deschide platforma nouă.

**4. Conectează Shopify.**
Mergi la **Setări → Integrări**. Dacă Shopify nu are bifă verde, apasă **Conectează Shopify (instalare aplicație)** și aprobă în Shopify.

Dacă Shopify afișează o eroare despre `redirect_uri`, deschide aplicația în [dev.shopify.com](https://dev.shopify.com) (sau în Partners). Adaugă la **Allowed redirection URL(s)**:

```
https://hub.ieftinit.ro/api/shopify/callback
```

Apoi apasă din nou butonul.

**5. Verifică formularele de pe magazin.**
În Shopify: **Online Store → Themes → Customize**. Deschide pagina *formular-retur* și secțiunea **IEFTINIT Retururi**. Câmpul **URL formular** trebuie să fie:

```
https://hub.ieftinit.ro/retur?embed=1
```

Fă la fel pe pagina *formular-service*, la secțiunea de service:

```
https://hub.ieftinit.ro/service/public?embed=1
```

Salvează. Apoi trimite câte o cerere de test din fiecare formular și verifică dacă apare în hub.

**6. Abia acum poți închide proiectul din Emergent.**

---

## Emailuri către clienți (opțional, dar recomandat)

Hub-ul vechi trimitea de pe `onboarding@resend.dev`. Resend livrează de pe acea adresă doar către proprietarul contului, deci clienții nu primeau confirmări.

Ca să primească:

1. Intră în [resend.com](https://resend.com) → **Domains** → **Add Domain** → `ieftinit.ro`.
2. Adaugă în DNS înregistrările pe care ți le arată Resend și apasă **Verify**.
3. În hub: **Setări → Integrări** → **Trimite-mi un email de test**.

`SENDER_EMAIL` e deja setat pe `IEFTINIT.RO <retururi@ieftinit.ro>`.

---

## Actualizări ulterioare

Când îți trimit o versiune nouă, dezarhivează peste folderul vechi și rulează în Terminal:

```
cd ~/Downloads/hub-ieftinit
railway up --detach
```

Datele și pozele nu se pierd: stau în MongoDB și pe discul `/data`.
