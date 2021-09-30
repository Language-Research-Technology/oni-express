const github = require('../services/Github');
const _ = require('lodash');

function authorize({config, url, session}) {

  let filterQuery = [];
  const group = config['auth']['group'];
  if (session['memberships'] && session['memberships']['teams']) {
    const sessionTeams = session['memberships']['teams'];
    const teams = config['auth']['teams'];
    for (let t of teams) {
      const found = sessionTeams.find(function (tt) {
        const org = tt['team']['organization'] || null;
        if (org && org['login'] === group) {
          return tt['team']['slug'] === t;
        }
      });
      if (found) {
        filterQuery.push(`${t}`);
      }
    }
    const fq = [];
    _.each(filterQuery, (filter) => {
      return _.find(config['auth']['licenses'], (l) => {
        if (l['team'] === filter) {
          fq.push(`"${encodeURIComponent(l['license'])}"`);
        }
      })
    });
    let filter = '';
    const base = config['solr_fq'] || '_license';
    if (fq.length > 0) {
      const filterJoin = fq.join('%20OR%20');
      filter = base + '%3A("Public"%20OR%20' + filterJoin + ')'
    } else {
      filter = base + '%3APublic';
    }
    const mod = url + '&fq=' + filter;
    return mod;
  } else {
    const base = config['solr_fq'] || '_license';
    const filter = base + '%3APublic';
    return url + '&fq=' + filter;
  }
}

async function setUserAccess({config, user}) {

  const group = config['auth']['group'] || [];
  const teamMembership = await github.getTeamMembership({
    user: {
      username: user.username,
      accessToken: user.accessToken
    }, group: group
  });

  return teamMembership;
}

module.exports = {authorize, setUserAccess};
