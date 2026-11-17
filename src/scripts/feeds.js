// Public RSS feeds used for ingestion. Articles are taken round-robin across
// feeds so the index covers a spread of outlets and topics.
export const FEEDS = [
  { source: "BBC News", topic: "World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "BBC News", topic: "Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "BBC News", topic: "Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { source: "BBC News", topic: "Science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" },
  { source: "The Guardian", topic: "World", url: "https://www.theguardian.com/world/rss" },
  { source: "The Guardian", topic: "Technology", url: "https://www.theguardian.com/uk/technology/rss" },
  { source: "The Guardian", topic: "Business", url: "https://www.theguardian.com/uk/business/rss" },
  { source: "Al Jazeera", topic: "World", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "DW", topic: "World", url: "https://rss.dw.com/rdf/rss-en-all" },
  { source: "CBS News", topic: "World", url: "https://www.cbsnews.com/latest/rss/world" },
];
