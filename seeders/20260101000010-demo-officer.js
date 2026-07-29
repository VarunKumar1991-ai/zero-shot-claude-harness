"use strict";

const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");

const SEED_USERNAME = "officer.demo";
const SEED_PASSWORD = "Password123!";
const SALT_ROUNDS = 10;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const existing = await queryInterface.rawSelect(
      "users",
      { where: { username: SEED_USERNAME } },
      ["id"]
    );

    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`\nDemo officer account already seeded (username: ${SEED_USERNAME}).\n`);
      return;
    }

    const passwordHash = await bcrypt.hash(SEED_PASSWORD, SALT_ROUNDS);
    const now = new Date();

    await queryInterface.bulkInsert("users", [
      {
        id: randomUUID(),
        username: SEED_USERNAME,
        passwordHash,
        displayName: "Insp. Demo Officer",
        createdAt: now,
      },
    ]);

    // eslint-disable-next-line no-console
    console.log("\nSeeded test officer account (Phase 1 local login):");
    // eslint-disable-next-line no-console
    console.log(`  username: ${SEED_USERNAME}`);
    // eslint-disable-next-line no-console
    console.log(`  password: ${SEED_PASSWORD}\n`);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("users", { username: SEED_USERNAME });
  },
};
