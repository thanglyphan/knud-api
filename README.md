# Regnskap API

Backend for regnskaps-chatbot med AI-støtte og PostgreSQL-persistens.

## Hurtigstart

### 1. Start database med Docker

```bash
docker compose up -d
```

Dette starter PostgreSQL på port 5434.

### 2. Konfigurer miljøvariabler

```bash
cp .env.example .env
```

Rediger `.env` og legg til din OpenAI API-nøkkel:
```
OPENAI_API_KEY=sk-...
```

### 3. Installer avhengigheter og kjør migrasjoner

```bash
npm install
npx prisma migrate dev
```

### 4. Start utviklingsserver

```bash
npm run dev
```

Serveren kjører på `http://localhost:3001`.

---

## API-endepunkter

### Health Check
```
GET /health
```
Returnerer status for server og databaseforbindelse.

### Chat CRUD

| Metode | Endepunkt | Beskrivelse |
|--------|-----------|-------------|
| `GET` | `/api/chats` | Hent alle chatter |
| `GET` | `/api/chats/:id` | Hent en chat med meldinger |
| `POST` | `/api/chats` | Opprett ny chat |
| `PATCH` | `/api/chats/:id` | Oppdater chat (tittel) |
| `DELETE` | `/api/chats/:id` | Slett chat |
| `POST` | `/api/chats/:id/messages` | Legg til melding |
| `POST` | `/api/chats/:id/messages/batch` | Legg til flere meldinger |

### AI Chat (med streaming)
```
POST /api/chat
Content-Type: application/json

{
  "chatId": "uuid",  // Optional - lagrer svar i DB
  "messages": [
    { "role": "user", "content": "Hva er MVA-satsen i Norge?" }
  ]
}
```

### AI Chat (uten streaming)
```
POST /api/chat/sync
```

---

## Database

### Skjema

```
Chat
├── id (UUID)
├── title
├── userId (nullable, for fremtidig auth)
├── createdAt
├── updatedAt
└── messages[]

Message
├── id (UUID)
├── role ("user" | "assistant")
├── content
├── createdAt
└── chatId (FK)
```

### Prisma-kommandoer

```bash
# Kjør migrasjoner
npx prisma migrate dev

# Åpne Prisma Studio (database GUI)
npx prisma studio

# Generer Prisma Client på nytt
npx prisma generate

# Reset database (SLETTER ALL DATA)
npx prisma migrate reset
```

---

## Miljøvariabler

| Variabel | Beskrivelse | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Din OpenAI API-nøkkel | - |
| `PORT` | Server port | 3001 |
| `DATABASE_URL` | PostgreSQL connection string | Se .env.example |

---

## Docker

### Kommandoer

```bash
# Start database
docker compose up -d

# Stopp database
docker compose down

# Stopp og slett data
docker compose down -v

# Se logger
docker compose logs -f
```

### Endre port

Hvis port 5434 er opptatt, endre i `docker-compose.yml`:
```yaml
ports:
  - "5435:5432"  # Endre 5434 til en ledig port
```

Og oppdater `DATABASE_URL` i `.env`.

---

## Teknologi

- **Express.js** - Web-rammeverk
- **Vercel AI SDK** - AI-streaming
- **OpenAI GPT-4o-mini** - Språkmodell
- **Prisma** - Database ORM
- **PostgreSQL** - Database
- **TypeScript** - Type-sikkerhet
- **Docker** - Containerisering

---

## Feilsøking

### Port allerede i bruk

```bash
# Finn prosess som bruker port
lsof -i :5434

# Eller endre port i docker-compose.yml
```

### Database-tilkobling feiler

```bash
# Sjekk at containeren kjører
docker compose ps

# Sjekk logger
docker compose logs postgres
```

### Prisma-feil

```bash
# Regenerer client
npx prisma generate

# Hvis skjema er ute av sync
npx prisma migrate dev
```
