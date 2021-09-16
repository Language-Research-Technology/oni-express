function speaker(item, crate) {

  if (item["@type"].includes("CorpusItem")) {
    if (item['speaker'] && item['speaker']['@id']) {
      const person = crate.getItem(item["speaker"]["@id"]);
      return person;
    }
  }

}

module.exports = speaker;
