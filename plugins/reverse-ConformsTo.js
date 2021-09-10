function isMemberOf(item, crate) {

  if (item['@reverse'] && Array.isArray(item['@reverse']['hasMember'])) {
    const reverseRel = item['@reverse']['hasMember'];
    const reverses = [];
    for (let r of reverseRel) {
      const po = crate.getItem(r['@id']);
      reverses.push({"id": po['@id'], "name": po['name'], "identifier": po['identifier']});
    }
    return reverses;
  }

}

module.exports = isMemberOf;
