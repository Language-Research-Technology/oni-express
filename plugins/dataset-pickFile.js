/*
hasFile is not on the RoCrate so needs to be added if you are using it.
 */

const fs = require('fs-extra');
const path = require('path');
const _ = require('lodash');

async function hasFile(item, crate, cf) {

  const baseOcflPath = cf?.textFile?.base_ocfl;
  const ocflPath = cf?.textFile?.ocfl_path;
  if (ocflPath) {
    if (item["@type"].includes("Dataset")) {
      if (item['hasPart']) {
        const itemId = 'arcp://name,multilingual.gov.au/item/';
        const procText = crate.getItem(itemId + item['@id']);
        const contents = [];
        if (procText) {
          for (let hasPart of procText?.hasFile) {
            if (hasPart['@id'].endsWith('.txt')) {
              const content = await getContent(hasPart['@id'], baseOcflPath, ocflPath)
              contents.push(content);
            }
          }
          if (contents.length > 0) {
            return contents
          } else {
            return '';
          }
        }
      }
    }
  }
}

async function getContent(hasId, baseOcflPath, ocflPath) {
  const filePath = path.join(baseOcflPath, ocflPath, 'v1/content/', hasId);
  const content = await fs.readFile(filePath, 'utf8');
  return content;
}

module.exports = hasFile;
