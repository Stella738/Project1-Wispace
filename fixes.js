const profilePage = document.querySelector('#profile-page');
const settingsList = profilePage.querySelector('.settings-list');
const legacyVault = settingsList.children[2];
legacyVault.remove();

const profileCurrency = document.querySelector('#profile-currency');
const currencySelect = document.createElement('select');
currencySelect.id = 'profile-currency';
currencySelect.innerHTML = '<option value="$">USD ($)</option><option value="CAD">CAD ($)</option><option value="EUR">EUR (€)</option>';
profileCurrency.replaceWith(currencySelect);
currencySelect.addEventListener('change', (event) => {
  state.currency = event.target.value;
  refresh();
});

const introButtons = document.querySelectorAll('[data-action="welcome"]');
introButtons.forEach((button) => {
  button.dataset.action = 'intro';
  button.addEventListener('click', () => { window.location.href = 'intro.html'; });
});

const goalsTitle = document.querySelector('#goals-page .page-title');
const addGoal = document.createElement('button');
addGoal.className = 'add-button';
addGoal.dataset.action = 'new-goal';
addGoal.innerHTML = 'Add Goal <span>+</span>';
goalsTitle.classList.add('goals-title');
goalsTitle.appendChild(addGoal);
addGoal.addEventListener('click', () => {
  showPage('goals-page');
  document.querySelector('#target-input').focus();
});
