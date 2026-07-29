"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Dataset extends Model {
    static associate(models) {
      Dataset.belongsTo(models.User, { foreignKey: "createdByUserId", as: "createdBy" });
      Dataset.hasMany(models.DatasetFile, { foreignKey: "datasetId", as: "files" });
      Dataset.hasMany(models.Query, { foreignKey: "datasetId", as: "queries" });
      Dataset.hasMany(models.Annotation, { foreignKey: "datasetId", as: "annotations" });
      // Phase 2 lineage: no enforced DB-level FK (would create a circular
      // dependency with Query.datasetId at migration time), tracked at the
      // application layer only.
      Dataset.belongsTo(models.Query, {
        foreignKey: "derivedFromQueryId",
        as: "derivedFromQuery",
        constraints: false,
      });
    }
  }

  Dataset.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      createdByUserId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      rowCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      columns: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      dateRangeMin: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      dateRangeMax: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      qualityFlags: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      combineStrategy: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      derivedFromQueryId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Dataset",
      tableName: "datasets",
      timestamps: true,
    }
  );

  return Dataset;
};
