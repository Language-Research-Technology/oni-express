const fs = require('fs-extra');

const sleep = ms => new Promise((r, j) => {
  setTimeout(r, ms * 1000);
});

async function readConf(logger, portalcf) {
  logger.debug("Loading " + portalcf);
  try {
    const conf = await fs.readJson(portalcf);
    return conf;
  } catch (e) {
    logger.error(e);
    logger.error(`Configuration File: ${portalcf} not found`);
    throw new Error(`Configuration File: ${portalcf} not found`);
  }
}

module.exports = {sleep, readConf};
