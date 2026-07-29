"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Annotation extends Model {
    static associate(models) {
      Annotation.belongsTo(models.Dataset, { foreignKey: "datasetId", as: "dataset" });
      Annotation.belongsTo(models.User, { foreignKey: "createdByUserId", as: "createdBy" });
    }
  }

  Annotation.init(
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
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      columnName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "Annotation",
      tableName: "annotations",
      timestamps: false,
    }
  );

  return Annotation;
};
