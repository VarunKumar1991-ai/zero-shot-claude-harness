"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("queries", {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      datasetId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "datasets",
          key: "id",
        },
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
      },
      sessionId: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      question: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      complexity: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      plan: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      generatedCode: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      attempts: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      result: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      answer: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      keyNumbers: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      assumptions: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      chartSpec: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      followups: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      tokenUsage: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("queries");
  },
};
