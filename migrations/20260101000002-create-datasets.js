"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("datasets", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      createdByUserId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      rowCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      columns: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      dateRangeMin: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      dateRangeMax: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      qualityFlags: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      combineStrategy: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      // Phase 2 lineage pointer to queries.id. No DB-level FK: queries.datasetId
      // already references datasets, so a reciprocal constraint here would be
      // circular at migration time. Enforced at the application layer only.
      derivedFromQueryId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("datasets");
  },
};
