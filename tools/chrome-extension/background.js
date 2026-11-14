// Кнопка на панели браузера: открытая статья → «Чтение» в Задачах.
// Открывает маленькое окно приложения с адресом и названием; приложение само кладёт статью в список
// (берёт название, сайт и дату со страницы), пишет «Добавлено» или «⚠ Уже есть» и закрывается.
// Вход — тот же, что у сайта Задач в этом браузере (если окно попросит войти — войти один раз).
const APP = 'https://poteryahina2014-glitch.github.io/tasks/';

function send(url, title) {
  if (!/^https?:\/\//i.test(url || '')) return;
  const q = new URLSearchParams({ pop: '1', url, title: title || '' });
  chrome.windows.create({ url: APP + '?' + q, type: 'popup', width: 440, height: 260, focused: true });
}

// щелчок по кнопке (или Alt+Shift+R) — текущая вкладка
chrome.action.onClicked.addListener(tab => send(tab.url, tab.title));

// правый щелчок по ссылке (например, в ленте Хабра) — статья по ссылке, не открывая её
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'link', title: 'В «Чтение»', contexts: ['link'] });
  chrome.contextMenus.create({ id: 'page', title: 'Эту страницу — в «Чтение»', contexts: ['page'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'link') send(info.linkUrl, '');
  else send(tab.url, tab.title);
});
