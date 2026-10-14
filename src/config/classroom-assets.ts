import { AssetType, type AssetManifest } from "@iwsdk/core";

// World.create waits only for critical assets. The NASA source supplies the
// classroom seats, windows, and ceiling immediately after login, including when
// a saved student session resumes before background downloads could finish.
export const classroomAssets: AssetManifest = {
  classroom2: {
    url: "./gltf/classroom2/theater_classroom2.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  nasaSeatSource: {
    url: "./gltf/classroom2/vrclass-nasa-classroom.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  sunsetHDR: {
    url: "./hdr/venice_sunset_1k.hdr",
    type: AssetType.HDRTexture,
    priority: "critical"
  },

  raiseHandIcon: {
    url: "./gltf/icons/raise-hand1.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  labEnvironmentModel: {
    url: "./python-type-lab-models/lab-environment.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  tableModel: {
    url: "./python-type-lab-models/table.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  cardModel: {
    url: "./python-type-lab-models/card.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  intBinModel: {
    url: "./python-type-lab-models/bin-int.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  floatBinModel: {
    url: "./python-type-lab-models/bin-float.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  boolBinModel: {
    url: "./python-type-lab-models/bin-bool.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  strBinModel: {
    url: "./python-type-lab-models/bin-str.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  newCardButtonModel: {
    url: "./python-type-lab-models/new-card-button.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  resetButtonModel: {
    url: "./python-type-lab-models/reset-button.glb",
    type: AssetType.GLTF,
    priority: "critical"
  },

  dispenserModel: {
    url: "./python-type-lab-models/card-dispenser-animation.glb",
    type: AssetType.GLTF,
    priority: "critical"
  }
};
