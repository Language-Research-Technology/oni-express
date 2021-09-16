/*
hasFile is not on the RoCrate so needs to be added if you are using it.
 */

function hasFile(item, crate) {

  if (item["@type"].includes("RepositoryObject")) {
    if (item['hasFile']) {
      for (let hasFile of item['hasFile']) {
        const has = crate.getItem(hasFile["@id"]);
        return has;
      }
    }
  }

}

module.exports = hasFile;
