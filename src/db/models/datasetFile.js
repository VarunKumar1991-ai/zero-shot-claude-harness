"use strict";

const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class DatasetFile extends Model {
    static associate(models) {
      DatasetFile.belongsTo(models.Dataset, { foreignKey: "datasetId", as: "dataset" });
    }
  }

  DatasetFile.init(
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
      originalFilename: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      filePath: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      fileSizeBytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      rowCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      uploadedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "DatasetFile",
      tableName: "dataset_files",
      timestamps: false,
    }
  );

  return DatasetFile;
};
