const github = require('../services/Github');

function authorize({config, url, session}) {

  let filterQuery = [];
  if (session['memberships'] && session['memberships']['teams']) {
    const sessionTeams = session['memberships']['teams'];
    const teams = config['auth']['teams'];
    for (let t of teams) {
      const found = sessionTeams.find(function (tt) {
        return tt['team']['slug'] === t;
      });
      if (found) {
        filterQuery.push(`${t}`)
      }
    }
    const filterJoin = ',' + filterQuery.join(',');
    const base = config['solr_fq'];
    const mod = url + '&fq=' + base + filterJoin;
    return mod;
  } else {
    return url + '&fq=' + config['solr_fq']
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
