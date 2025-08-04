/*
 * Copyright © 2023 Boris Bobylev. All rights reserved.
 * Licensed under the Apache License, Version 2.0
*/

const { ImportManager, MainProcess } = require("vrack2-core");
const { isMainThread, workerData } = require("worker_threads");

let MainProcessPath = 'vrack2-core.MainProcess';
let processFile = 'devices/vrack2/vrack2.json';
let confFile = 'devices/vrack2/vrack2.conf.json';
let id = 'vrack2';

async function run() {
    if (isMainThread && process.argv.length === 3) {
        processFile = process.argv[process.argv.length - 1];
    } else if (!isMainThread) {
        MainProcessPath = workerData.MainProcess;
        processFile = workerData.processFile;
        id = workerData.contaierId;
        confFile = workerData.confFile;
    }

    const service = await ImportManager.importJSON(processFile);
    const MainProcessClass = await ImportManager.importClass(MainProcessPath);
    const MainProcessEx = new MainProcessClass({ id, service, confFile });
    MainProcessEx.run();
}

run();