import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const count = await db.song.count();
  const songs = await db.song.findMany({ take: 10 });
  console.log("TOTAL_SONGS_IN_DB:", count);
  console.log("SONGS:", JSON.stringify(songs, (key, value) => typeof value === "bigint" ? value.toString() : value, 2));
}

main().catch(console.error).finally(() => db.$disconnect());
