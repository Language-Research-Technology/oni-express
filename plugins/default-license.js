function defaultLicense(item, crate, cf) {

  if (item['license']) {
    const license = item['license'];//if item does not match the list return a public
    if (cf['license'] && cf['license']['licenses']) {
      const licSet = cf['license']['licenses'];
      if (licSet.includes(license) || licSet.includes(license['@id'])) {
        return [license['@id'] || license];
      } else {
        return ['Public'];
      }
    }
  } else {
    return ['Public'];
  }

}

module.exports = defaultLicense;
