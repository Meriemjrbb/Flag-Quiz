import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import ejs from "ejs"; // import explicite : Vercel doit voir ce module pour l'inclure
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

// --- Base de données ---------------------------------------------------------
// En production (Vercel) : variable d'environnement DATABASE_URL.
// En local : on retombe sur ta base PostgreSQL locale.
const databaseUrl = process.env.DATABASE_URL;

const db = databaseUrl
  ? new pg.Pool({
      // On retire sslmode de l'URL : on gère le SSL explicitement ci-dessous
      connectionString: databaseUrl.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""),
      ssl: { rejectUnauthorized: false },
      max: 3, // peu de connexions : on est en mode serverless
    })
  : new pg.Pool({
      user: "postgres",
      host: "localhost",
      database: "world",
      password: "123456789",
      port: 5432,
    });

// --- Configuration Express ---------------------------------------------------
app.engine("ejs", ejs.__express);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // en local ; sur Vercel, public/ est servi automatiquement

// --- Données du quiz ---------------------------------------------------------
// Chargées une fois, puis gardées en mémoire (le quiz ne change pas).
let quizCache = null;

async function getQuiz() {
  if (!quizCache) {
    const result = await db.query("SELECT name, flag FROM flags");
    quizCache = result.rows;
  }
  return quizCache;
}

// Un emoji drapeau = 2 "lettres régionales" Unicode. On les convertit en code pays
// ISO (ex. 🇱🇦 -> "la") pour afficher une VRAIE image : Windows n'affiche pas les
// emojis de drapeaux (il montre seulement les 2 lettres).
function flagToCode(flag) {
  return [...flag]
    .map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 97))
    .join("");
}

async function randomQuestion() {
  const quiz = await getQuiz();
  const q = quiz[Math.floor(Math.random() * quiz.length)];
  return { ...q, code: flagToCode(q.flag) };
}

// --- Routes ------------------------------------------------------------------
// L'état du jeu (drapeau posé, score) voyage dans le formulaire (champs cachés),
// car sur Vercel la mémoire du serveur n'est pas partagée entre les requêtes.
app.get("/", async (req, res) => {
  try {
    const question = await randomQuestion();
    res.render("index.ejs", { question });
  } catch (err) {
    console.log(err);
    res.status(500).send("Erreur de base de données : " + err.message);
  }
});

app.post("/submit", async (req, res) => {
  try {
    const answer = (req.body.answer || "").trim();
    const askedName = req.body.flagName || "";
    let score = parseInt(req.body.score, 10) || 0;

    // On retrouve la bonne réponse côté serveur (on ne fait pas confiance au navigateur)
    const quiz = await getQuiz();
    const asked = quiz.find((q) => q.name === askedName);
    const isCorrect =
      !!asked && asked.name.toLowerCase() === answer.toLowerCase();
    if (isCorrect) score++;

    const question = await randomQuestion();
    res.render("index.ejs", {
      question,
      wasCorrect: isCorrect,
      totalScore: score,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Erreur : " + err.message);
  }
});

// En local uniquement : sur Vercel, l'app est exportée ci-dessous
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;
