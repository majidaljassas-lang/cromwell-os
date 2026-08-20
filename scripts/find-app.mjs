#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const suppliers = await prisma.supplier.findMany({
  where: {
    name: {
      contains: "APP",
      mode: "insensitive"
    }
  },
  select: { id: true, name: true }
});

console.log(JSON.stringify(suppliers, null, 2));
await prisma.$disconnect();
