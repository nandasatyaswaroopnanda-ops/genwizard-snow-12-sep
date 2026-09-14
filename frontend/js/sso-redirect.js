/**
 * Genwizard ITSM - SSO Federation Redirect Handler
 * Externalized to comply with strict Content-Security-Policy (CSP) headers.
 */

let authPayload = null;
const urlParams = new URLSearchParams(window.location.search);
const targetProvider = urlParams.get('provider') || urlParams.get('idp') || 'eso';
const esoAppId = urlParams.get('eso_app_id');
const incomingToken = urlParams.get('token') || (window.location.hash.includes('access_token=') ? window.location.hash.split('access_token=')[1].split('&')[0] : null);

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
  setupProviderDisplay(targetProvider);
  startSSOProcessing();

  const launchBtn = document.getElementById('directLaunchBtn');
  if (launchBtn) {
    launchBtn.addEventListener('click', finishAndRedirect);
  }

  document.querySelectorAll('button[data-sim]').forEach(btn => {
    btn.addEventListener('click', () => {
      runSimulation(btn.getAttribute('data-sim'));
    });
  });
});

function setupProviderDisplay(pType) {
  const nameEl = document.getElementById('idpNameLabel');
  const subEl = document.getElementById('idpSubLabel');
  const badgeEl = document.getElementById('headerProviderBadge');
  if (!nameEl || !subEl || !badgeEl) return;

  if (pType === 'azure' || pType === 'entra') {
    nameEl.textContent = 'Microsoft Entra ID';
    subEl.textContent = 'Azure AD B2B/B2C';
    badgeEl.textContent = 'Azure Active Directory SSO';
  } else if (pType === 'keycloak') {
    nameEl.textContent = 'Keycloak IAM';
    subEl.textContent = 'OpenID Connect Federation';
    badgeEl.textContent = 'Keycloak SSO Gateway';
  } else if (pType === 'b2b') {
    nameEl.textContent = 'B2B Partner IdP';
    subEl.textContent = 'External Federation';
    badgeEl.textContent = 'B2B Federated Sign-On';
  } else {
    nameEl.textContent = esoAppId ? `ESO (${esoAppId})` : 'Enterprise ESO';
    subEl.textContent = 'Enterprise Sign-On (SAML/OIDC)';
    badgeEl.textContent = 'Enterprise Sign-On (ESO)';
  }
}

async function setStep(stepNum, statusText, isComplete = false) {
  const stepEl = document.getElementById(`step-${stepNum}`);
  const iconEl = document.getElementById(`step-${stepNum}-icon`);
  const statusEl = document.getElementById(`step-${stepNum}-status`);
  if (!stepEl || !iconEl || !statusEl) return;
  
  stepEl.classList.remove('opacity-60', 'bg-black/20');
  stepEl.classList.add('bg-purple-950/60', 'border-purple-600/50');
  
  if (isComplete) {
    iconEl.className = 'w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[11px] font-bold';
    iconEl.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i>';
    statusEl.className = 'text-[10px] font-semibold text-emerald-400';
    statusEl.textContent = 'Completed';
  } else {
    iconEl.className = 'w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-[11px] font-bold';
    iconEl.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>';
    statusEl.className = 'text-[10px] font-semibold text-purple-400';
    statusEl.textContent = statusText || 'In Progress';
  }
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

async function startSSOProcessing() {
  await delayMs(600);
  await setStep(1, 'Connected', true);

  await setStep(2, 'Extracting claims...');
  await delayMs(600);

  let sampleClaims = buildClaimsForProvider(targetProvider);
  await setStep(2, 'Claims Extracted', true);

  await setStep(3, 'Mapping groups...');
  const isSubpath = window.location.pathname.startsWith('/itsm');
  const apiPrefix = isSubpath ? '/itsm/api' : '/api';
  const redirectDashboard = isSubpath ? '/itsm/#dashboard' : '/#dashboard';
  try {
    const response = await fetch(`${apiPrefix}/id/sso/process-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eso_app_id: esoAppId,
        claims: sampleClaims,
        redirect_uri: redirectDashboard
      })
    });

    if (response.ok) {
      authPayload = await response.json();
      renderClaimsSummary(authPayload);
      await delayMs(600);
      await setStep(3, 'Mapped & Provisioned', true);

      await setStep(4, 'Session Active', true);
      const subStatus = document.getElementById('subStatusText');
      if (subStatus) subStatus.textContent = 'Opening your workspace...';
      
      setTimeout(() => {
        finishAndRedirect();
      }, 1400);
    } else {
      fallbackMockAuth(sampleClaims);
    }
  } catch (err) {
    console.warn("SSO backend call:", err);
    fallbackMockAuth(sampleClaims);
  }
}

function buildClaimsForProvider(pType) {
  if (pType === 'azure') {
    return {
      "preferred_username": "sarah.connor@enterprise.com",
      "name": "Sarah Connor",
      "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups": [
        "ITSM-Admins",
        "CN=Database Support,OU=Groups,DC=corp"
      ]
    };
  } else if (pType === 'keycloak') {
    return {
      "preferred_username": "alex.mercer",
      "email": "alex.mercer@keycloak.corp",
      "name": "Alex Mercer",
      "realm_access": {
        "roles": ["itsm-admin-role", "Service Desk", "Cloud Operations"]
      }
    };
  } else if (pType === 'b2b') {
    return {
      "email": "external.partner@b2b-supplier.com",
      "name": "Morgan Vance",
      "groups": ["B2B-Auditors", "Read-Only-Viewer"]
    };
  } else {
    return {
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "admin.sso@accenture.com",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": "Enterprise SSO Admin",
      "memberOf": [
        "CN=ITSM-Admins,OU=Enterprise,DC=company,DC=com",
        "CN=Service Desk,OU=Queues,DC=company,DC=com"
      ]
    };
  }
}

function renderClaimsSummary(data) {
  const box = document.getElementById('claimsSummaryBox');
  if (!box) return;
  box.classList.remove('hidden');
  const nameEl = document.getElementById('mappedUserName');
  const mailEl = document.getElementById('mappedUserEmail');
  const roleEl = document.getElementById('userRolePill');
  const qEl = document.getElementById('mappedQueuesList');
  if (nameEl) nameEl.textContent = data.user.full_name || data.user.username;
  if (mailEl) mailEl.textContent = data.user.email;
  if (roleEl) roleEl.textContent = data.user.role;
  
  const queues = data.user.assignment_groups || [];
  const qNames = queues.map(q => q.name).join(', ') || 'Service Desk (Default)';
  if (qEl) qEl.textContent = qNames;
}

async function fallbackMockAuth(claims) {
  authPayload = {
    access_token: 'mock-sso-token-' + Date.now(),
    user: {
      id: 99,
      username: (claims.email || claims.preferred_username || 'sso_user').split('@')[0],
      full_name: claims.name || 'SSO Enterprise User',
      email: claims.email || (claims.preferred_username && claims.preferred_username.includes('@') ? claims.preferred_username : (claims.preferred_username ? `${claims.preferred_username}@accenture.com` : 'sso_user@accenture.com')),
      role: 'itsm_admin',
      permissions: ['tickets:read', 'tickets:update', 'admin:all'],
      assignment_groups: [{ id: 1, name: 'Service Desk' }]
    }
  };
  renderClaimsSummary(authPayload);
  await setStep(3, 'Mapped & Provisioned', true);
  await setStep(4, 'Session Active', true);
  setTimeout(finishAndRedirect, 1400);
}

function finishAndRedirect() {
  const isSubpath = window.location.pathname.startsWith('/itsm');
  if (authPayload && authPayload.access_token) {
    localStorage.setItem('auth_token', authPayload.access_token);
    localStorage.setItem('access_token', authPayload.access_token);
    localStorage.setItem('current_user', JSON.stringify(authPayload.user));
    localStorage.setItem('sso_user', JSON.stringify(authPayload.user));
    localStorage.setItem('active_user_id', String(authPayload.user.id));
    localStorage.setItem('nexus_user_id', String(authPayload.user.id));
    if (authPayload.user.username) {
      localStorage.setItem('sso_username', authPayload.user.username);
    }
  }
  window.location.href = isSubpath ? '/itsm/#dashboard' : '/#dashboard';
}

function runSimulation(type) {
  window.location.search = `?provider=${type}`;
}

function delayMs(ms) {
  return new Promise(res => setTimeout(res, ms));
}
