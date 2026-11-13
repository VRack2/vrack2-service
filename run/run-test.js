/*
 * Copyright © 2023 Boris Bobylev. All rights reserved.
 * Licensed under the Apache License, Version 2.0
 */

/*
 * run-test.js — тест устройства/графа одной строкой:
 *
 *   node run/run-test.js devices/<vendor>/tests/<name>.js
 *
 * Файл теста экспортирует две функции:
 *
 *   structure()            — структура сервиса (devices/connections), который
 *                            тестируется. Обычно собирается из боевого сервиса
 *                            (`require('../../services/x.json')` + слой
 *                            наблюдения), чтобы граф не дублировать.
 *   run(container, ctx)    — тело теста. Получает живой Container и обращается к
 *                            устройствам напрямую: getDevice / deviceAction /
 *                            stopDevice / startDevice / getDeviceStatus.
 *                            Расхождение — бросить ошибку (node:assert).
 *
 * Ничего не подменяется: устройства живут в настоящем MainProcess/Container,
 * порты и соединения настоящие. От сервиса с MCP-прогоном это отличается только
 * способом подачи (код рядом с фикстурой, а не руки) и тем, что прогон
 * повторяем: одна команда, код выхода 0/1.
 *
 * Бут изолирован во временном каталоге — storage/structure теста не попадают в
 * репозиторий. Порты устройств тест выбирает сам (см. константу PORT в фикстуре),
 * чтобы не спорить с запущенным стендом.
 *
 * Коды выхода: 0 — прошёл, 1 — расхождение/таймаут, 2 — не собралось.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MainProcess } = require('vrack2-core');

const usage = 'usage: node run/run-test.js <path/to/test.js>';

async function main() {

    const file = process.argv[2];
    if (!file) {
        console.error(usage);
        return 2;
    }

    const test = require(path.resolve(file));
    if (typeof test.structure !== 'function' || typeof test.run !== 'function') {
        console.error(`${file}: тест должен экспортировать structure() и run()`);
        return 2;
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vrack2-test-'));

    const mp = new MainProcess({
        id: 'test',
        service: test.structure(),
        bootstrap: {
            DeviceStorage: { options: { storageDir: path.join(tmp, 'storage') } },
            StructureStorage: { options: { structureDir: path.join(tmp, 'structure') } },
        },
    });

    const container = mp.Container;
    const problems = [];

    for (const event of ['device.error', 'device.alert', 'device.terminate']) {
        container.on(event, (data) => {
            problems.push(`${event} ${data.device}: ${data.data}`);
            console.log(`! ${event} ${data.device}: ${data.data}`);
        });
    }

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const timeout = test.timeout || 30000;

    let code = 0;
    let failure = null;

    try {
        await mp.run();
    } catch (error) {
        console.error(`сервис не собрался: ${error.message}`);
        fs.rmSync(tmp, { recursive: true, force: true });
        return 2;
    }

    try {
        await Promise.race([
            test.run(container, { tmp, wait }),
            wait(timeout).then(() => { throw new Error(`таймаут ${timeout} мс`) }),
        ]);
    } catch (error) {
        code = 1;
        failure = error;
    }

    await mp.stop();
    fs.rmSync(tmp, { recursive: true, force: true });

    if (failure) {
        console.log(`\nFAIL ${path.relative(process.cwd(), file)}: ${failure.message}`);
        for (const status of container.deviceStatusList()) {
            if (status.errorCount || status.alertCount) {
                console.log(`   ${status.id} [${status.state}] errors=${status.errorCount} alerts=${status.alertCount}`
                    + (status.lastError ? ` lastError=${status.lastError.data}` : '')
                    + (status.lastAlert ? ` lastAlert=${status.lastAlert.data}` : ''));
            }
        }
        for (const line of problems) console.log(`   ${line}`);
    } else {
        console.log(`\nPASS ${path.relative(process.cwd(), file)}`);
    }

    return code;
}

main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(2);
});
