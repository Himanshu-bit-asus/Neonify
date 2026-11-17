import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const users = await db.user.findMany({ take: 10 });
  console.log("TOTAL_USERS_IN_DB:", users.length);
  console.log("USERS:", users);
}

main().catch(console.error).finally(() => db.$disconnect());
