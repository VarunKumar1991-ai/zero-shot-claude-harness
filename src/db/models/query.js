"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Query extends Model {
    static associate(models) {
      Query.belongsTo(models.Dataset, { foreignKey: "datasetId", as: "dataset" });
      Query.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    }
  }

  Query.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      datasetId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      sessionId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      question: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      complexity: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      plan: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      generatedCode: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      attempts: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      result: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      answer: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      keyNumbers: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      assumptions: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      chartSpec: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      followups: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      tokenUsage: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Query",
      tableName: "queries",
      timestamps: false,
    }
  );

  return Query;
};
