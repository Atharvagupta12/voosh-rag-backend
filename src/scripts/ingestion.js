// scripts/ingestion.js
import axios from "axios";
import * as cheerio from "cheerio";
import { getEmbedding } from "../services/embeddings.js";
import { insertArticle, initCollection } from "../services/qdrant.js";

// Example source: Reuters tech news (replace with your own feeds)
const NEWS_URLS = [
  "https://www.reuters.com/technology/",
  "https://www.reuters.com/world/"
];

// Extract text content from article HTML
async function fetchArticle(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    const title = $("h1").first().text();
    const paragraphs = $("p")
      .map((i, el) => $(el).text())
      .get()
      .join(" ");

    const text = `${title}\n\n${paragraphs}`;
    return text.trim();
  } catch (err) {
    console.error(" Error fetching article:", url, err.message);
    return null;
  }
}

async function ingest() {
  await initCollection();

  let idCounter = 1;

  for (const feed of NEWS_URLS) {
    try {
      const { data } = await axios.get(feed);
      const $ = cheerio.load(data);

      // Grab article links from the feed page
      const links = $("a[href]")
        .map((i, el) => $(el).attr("href"))
        .get()
        .filter((l) => l.includes("/article/")) // only actual articles
        .slice(0, 5); // limit for demo

      console.log(` Found ${links.length} articles in ${feed}`);

      for (const link of links) {
        const fullUrl = link.startsWith("http")
          ? link
          : `https://www.reuters.com${link}`;

        const article = await fetchArticle(fullUrl);
        if (!article) continue;

        const embedding = await getEmbedding(article);
        await insertArticle(idCounter++, article, embedding);
        console.log(` Inserted article: ${fullUrl}`);
      }
    } catch (err) {
      console.error(" Error scraping feed:", feed, err.message);
    }
  }

  console.log(" Ingestion complete.");
}

ingest();
