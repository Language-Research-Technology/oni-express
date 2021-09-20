function isMemberOf(item, crate) {

  if (item['@reverse'] && Array.isArray(item['@reverse']['hasMember'])) {
    const reverseRel = item['@reverse']['hasMember'];
    const reverses = [];
    for (let r of reverseRel) {
      const po = crate.getItem(r['@id']);
      let id = po['@id'];
      if (item['__id']) {
        id = item['__id'];
      }
      reverses.push({"id": id, "name": po['name'], "@type": po['@type']});
    }
    return reverses;
  }

}

module.exports = isMemberOf;
