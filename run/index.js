/*
 * Copyright © 2023 Boris Bobylev. All rights reserved.
 * Licensed under the Apache License, Version 2.0
*/
const path = require('path');

const { ImportManager, MainProcess, UniversalWorker } = require("vrack2-core");

let MainProcessPath = 'vrack2-core.MainProcess';
let processFile = 'devices/vrack2/vrack2.json';
let confFile = 'devices/vrack2/vrack2.conf.json';
let id = 'vrack2';


async function run() {
    if (!UniversalWorker.isChild && process.argv.length === 3) {
        processFile = process.argv[process.argv.length - 1];
        const parsed = path.parse(processFile);
        id = parsed.name;
        // A conf file only overrides/adds devices for the service it belongs to: it is
        // the sibling "<name>.conf.json" of the service file. The platform conf carries
        // the platform-only devices (Mcp :4405, Master, ServiceManager) and must NOT be
        // applied to an unrelated standalone service, or that service would bind the
        // platform's ports (EADDRINUSE). For the default platform service this resolves
        // back to devices/vrack2/vrack2.conf.json, so `npm start` is unchanged.
        const sibling = path.join(parsed.dir, parsed.name + '.conf.json');
        confFile = sibling;
    } else if (UniversalWorker.isChild) {
        const wd = UniversalWorker.getWorkerData()
        MainProcessPath = wd.MainProcess;
        processFile = wd.processFile;
        id = wd.contaierId;
        confFile = wd.confFile;
    }
    
    const service = await ImportManager.importJSON(processFile);
    const MainProcessClass = await ImportManager.importClass(MainProcessPath);
    const MainProcessEx = new MainProcessClass({ id, service, confFile });
    MainProcessEx.run();
}
run();