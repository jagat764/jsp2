import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ─── All Firebase Realtime Database URLs ───
const firebaseConfigs = {
    killerBoy:      { databaseURL: "https://killer-boy-3eac3-default-rtdb.firebaseio.com" },
    knsnsn:         { databaseURL: "https://knsnsn-8a8eb-default-rtdb.firebaseio.com" },
    krishLattu:     { databaseURL: "https://krish-lattu-default-rtdb.firebaseio.com" },
    koya:           { databaseURL: "https://koya-7acd9-default-rtdb.firebaseio.com" },
    kumar:          { databaseURL: "https://kumar-4d93e-default-rtdb.firebaseio.com" },
    leBhaii:        { databaseURL: "https://le-bhaii-default-rtdb.firebaseio.com" },
    lol:            { databaseURL: "https://lol-3e5e7-default-rtdb.firebaseio.com" },
    mame:           { databaseURL: "https://mame-23169-default-rtdb.firebaseio.com" },
    mast:           { databaseURL: "https://mast-d6890-default-rtdb.asia-southeast1.firebasedatabase.app" },
    matrixpannel81: { databaseURL: "https://matrixpannel81-default-rtdb.firebaseio.com" },
    mrSk:           { databaseURL: "https://mr-sk-ff683-default-rtdb.firebaseio.com" },
    ne:             { databaseURL: "https://ne-2db23-default-rtdb.asia-southeast1.firebasedatabase.app" },
    nehapannel:     { databaseURL: "https://nehapannel-6b62c-default-rtdb.firebaseio.com" },
    newgodx:        { databaseURL: "https://newgodx-5b008-default-rtdb.asia-southeast1.firebasedatabase.app" },
    newp:           { databaseURL: "https://newp-b4b77-default-rtdb.firebaseio.com" },
    nidhiRani:      { databaseURL: "https://nidhi-rani-default-rtdb.firebaseio.com" },
    nyawala:        { databaseURL: "https://nyawala-3e7c3-default-rtdb.asia-southeast1.firebasedatabase.app" },
    nkdfudvala:     { databaseURL: "https://nkdfudvala-default-rtdb.firebaseio.com" },
    panelAbc35:     { databaseURL: "https://panel-abc35-default-rtdb.firebaseio.com" },
    pikachuPanel:   { databaseURL: "https://pikachu-panel-default-rtdb.firebaseio.com" }
};

export const databases = {};
export const dbLabels = {};

for (const [name, cfg] of Object.entries(firebaseConfigs)) {
    const app = initializeApp(cfg, name);   // unique app name per URL
    databases[name] = getDatabase(app);
    dbLabels[name] = name;
}