const _ = require('lodash');
const fs = require('fs-extra');
const oi = require('../services/CatalogSolr');
const winston = require('winston');
const utils = require('../services/utils');

const consoleLog = new winston.transports.Console();
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.simple(),
  transports: [consoleLog]
});

async function getVersion() {
  const packageFile = await utils.readConf(logger, './package.json');
  return {version: packageFile.version};
}

// Script which takes the facet configuration for oni-indexer and uses it to build the facets
// section of the config for oni-portal.
async function getPortalConfig(argv) {
  const expresscf = argv.express;
  if (!expresscf) {
    return {error: `Couldn't read express config ${argv.express}`};
  }
  const indexcf = await utils.readConf(logger, argv.indexer);
  if (!expresscf) {
    return {error: `Couldn't read indexer config ${argv.indexer}`}
  }


  if (argv.base) {
    indexcf['portal']['base'] = argv.base;
  }
  if (argv.portal) {
    indexcf['portal']['config'] = argv.portal;
  }

  const basecf = await utils.readConf(logger, indexcf['portal']['base']);
  if (!basecf) {
    return {error: `Couldn't read base portal cf ${indexcf['portal']['base']}`}
  }

  const indexer = new oi.CatalogSolr(logger);
  indexer.setConfig(indexcf['fields']);

  const portalcf = await makePortalConfig(argv.indexer, indexcf, indexer.facets);

  // add ocfl api path

  const url_path = expresscf['ocfl']['url_path'];
  if (url_path) {
    logger.debug(`Setting ocfl endpoint to ${url_path}`);
    portalcf['apis']['ocfl'] = url_path;
  }

  return portalcf;
}

async function makePortalConfig(indexfile, cf, facets) {
  const portal = cf['portal'];

  const newFacets = {};

  for (let type in facets) {
    //TODO: explain this!
    for (let field in facets[type]) {
      let facetField = '';
      if (facets[type][field]['facetField']) {
        facetField = facets[type][field]['facetField'];

      } else {
        // this will catch the global facets : if(facets[type]['global'])
        facetField = facets[type]['facetField'];
      }
      if (portal['facetDefaults']) {
        newFacets[facetField] = _.cloneDeep(portal['facetDefaults']);
      } else {
        newFacets[facetField] = {};
      }
      if (facets[type][field]['facetField']) {
        newFacets[facetField]['field'] = field;
        newFacets[facetField]['label'] = field[0].toUpperCase() + field.substr(1);
      } else {
        //TODO: This whole thing is dirty!
        const fieldLabel = facetField.substring(0, facetField.indexOf("_facet"));
        newFacets[facetField]['field'] = fieldLabel;
        newFacets[facetField]['label'] = fieldLabel[0].toUpperCase() + fieldLabel.substr(1);
      }
      if (facets[type][field]['JSON']) {
        newFacets[facetField]['JSON'] = true;
      } else {
        newFacets[facetField]['JSON'] = true;
      }
    }
  }

  let portalcf = await utils.readConf(logger, portal['config']);
  let portalbase = "portal config " + portal['config'];

  if (portalcf) {
    logger.info(`Updating facets in existing portal config ${portal['config']}`);
  } else {
    logger.info(`Creating new portal config based on ${portal['base']}`);
    portalcf = await utils.readConf(logger, portal['base']);
    if (!portalcf) {
      return {error: "Can't read either existing portal config or portal base: exit"}
    }
    portalbase = "portal base config " + portal['base'];
  }

  for (let oldFacet in portalcf['facets']) {
    if (!newFacets[oldFacet]) {
      logger.info(`Removing facet ${oldFacet}`);
      delete portalcf['facets'][oldFacet];
      _.remove(portalcf['results']['resultFacets'], (f) => f === oldFacet);
      _.remove(portalcf['results']['searchFacets'], (f) => f === oldFacet);
    } else {
      portalcf['facets'][oldFacet]['field'] = newFacets[oldFacet]['field'];
      // update the JSON selector fields
      // keep the rest of the config (sort order, limit, etc)
      delete newFacets[oldFacet];
    }
  }

  // Add facets which weren't in the original facet list.

  // default behaviour is to add everything to the two facet lists

  for (let newFacet in newFacets) {
    logger.info(`Adding facet ${newFacet}`);
    portalcf['facets'][newFacet] = newFacets[newFacet];
    portalcf['results']['searchFacets'].push(newFacet);
    portalcf['results']['resultFacets'].push(newFacet);
  }

  // add facets to the single-item view summary and view fields

  for (let type in portalcf['results']['view']) {
    const typecf = portalcf['results']['view'][type];
    for (let summary of typecf['summaryFields']) {
      const field = summary['field'];
      const f = `${type}_${field}_facet`;
      const fm = `${type}_${field}_facetmulti`;
      logger.info(`Looking for view facet ${f} ${fm}`);
      if (portalcf['facets'][f]) {
        summary['facet'] = f;
      } else if (portalcf['facets'][fm]) {
        summary['facet'] = fm;
      } else {
        logger.info(".. not found");
      }
    }
  }

  return portalcf;
}

module.exports = {getVersion, getPortalConfig};
