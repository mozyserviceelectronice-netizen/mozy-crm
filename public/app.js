(() => {
  const token = document
    .querySelector('meta[name="csrf-token"]')
    ?.getAttribute('content');

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const method = String(
      form.getAttribute('method') || 'get'
    ).toLowerCase();

    if (method === 'post' && token) {
      let field = form.querySelector('input[name="_csrf"]');
      if (!field) {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = '_csrf';
        form.append(field);
      }
      field.value = token;
    }

    const confirmation = form.dataset.confirm;
    if (confirmation && !window.confirm(confirmation)) {
      event.preventDefault();
    }
  });

  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    if (target.dataset.action === 'print') {
      window.print();
      return;
    }

    if (target.dataset.action === 'copy') {
      const source = document.querySelector(
        target.dataset.copyTarget || ''
      );
      if (source && navigator.clipboard) {
        await navigator.clipboard.writeText(source.value || source.textContent);
      }
    }
  });

  const actionDropdowns = [
    ...document.querySelectorAll('.action-dropdown')
  ];

  actionDropdowns.forEach(dropdown => {
    dropdown.addEventListener('toggle', () => {
      if (!dropdown.open) return;
      actionDropdowns.forEach(other => {
        if (other !== dropdown) other.removeAttribute('open');
      });
    });
  });

  document.addEventListener('click', event => {
    if (event.target.closest('.action-dropdown')) return;
    actionDropdowns.forEach(dropdown => {
      dropdown.removeAttribute('open');
    });
  });

  const receptionList = document.querySelector(
    '[data-reception-list]'
  );
  const receptionReturnKey = 'mozy:reception:return-to';

  function sessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function sessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Navigarea rămâne funcțională și fără restaurarea poziției.
    }
  }

  function sessionRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Nu este necesară nicio acțiune suplimentară.
    }
  }

  function safeReceptionListUrl(value) {
    try {
      const url = new URL(value, window.location.origin);
      if (
        url.origin !== window.location.origin ||
        url.pathname !== '/receptie'
      ) {
        return null;
      }
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }

  if (receptionList) {
    const listUrl = safeReceptionListUrl(
      receptionList.dataset.receptionListUrl
    );

    if (listUrl) {
      const scrollKey = `mozy:reception:scroll:${listUrl}`;
      const storedScroll = sessionGet(scrollKey);
      const savedScroll = Number(storedScroll);

      if (
        storedScroll !== null &&
        Number.isFinite(savedScroll) &&
        savedScroll >= 0
      ) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: savedScroll, behavior: 'auto' });
          sessionRemove(scrollKey);
        });
      }

      document
        .querySelectorAll('[data-reception-detail-link]')
        .forEach(link => {
          link.addEventListener('click', () => {
            sessionSet(receptionReturnKey, listUrl);
            sessionSet(scrollKey, String(window.scrollY));
          });
        });
    }

    const filterBar = document.querySelector(
      '.reception-filters'
    );
    const activeFilter = filterBar?.querySelector(
      '[aria-current="page"]'
    );

    if (
      filterBar &&
      activeFilter &&
      filterBar.scrollWidth > filterBar.clientWidth
    ) {
      window.requestAnimationFrame(() => {
        filterBar.scrollTo({
          left:
            activeFilter.offsetLeft -
            (filterBar.clientWidth - activeFilter.offsetWidth) / 2,
          behavior: 'auto'
        });
      });
    }
  }

  const receptionBackLink = document.querySelector(
    '[data-reception-back-link]'
  );

  if (
    receptionBackLink &&
    receptionBackLink.dataset.hasReturnTo !== '1'
  ) {
    const storedReturnTo = safeReceptionListUrl(
      sessionGet(receptionReturnKey)
    );
    if (storedReturnTo) {
      receptionBackLink.setAttribute('href', storedReturnTo);
    }
  }

  function syncNoIntervalToggle(toggle) {
    const form = toggle.closest('form');
    const timeFields = form?.querySelector('[data-time-fields]');
    if (!timeFields) return;

    timeFields
      .querySelectorAll('input[type="time"]')
      .forEach(input => {
        input.disabled = toggle.checked;
        input.required = !toggle.checked;
      });
    timeFields.classList.toggle(
      'appointment-time-fields-disabled',
      toggle.checked
    );
  }

  document
    .querySelectorAll('[data-no-interval-toggle]')
    .forEach(toggle => {
      syncNoIntervalToggle(toggle);
      toggle.addEventListener('change', () => {
        syncNoIntervalToggle(toggle);
      });
    });

  const priceEditor = document.querySelector('[data-price-editor]');
  const priceTemplate = document.getElementById(
    'appointment-price-row-template'
  );

  function updatePriceRows() {
    if (!priceEditor) return;
    const rows = [
      ...priceEditor.querySelectorAll('[data-price-row]')
    ];
    rows.forEach((row, index) => {
      const amount = row.querySelector('[name="pret_valoare"]');
      const description = row.querySelector(
        '[name="pret_descriere"]'
      );
      const remove = row.querySelector('[data-remove-price]');
      if (amount) {
        amount.setAttribute(
          'aria-label',
          `Valoarea variantei de preț ${index + 1}`
        );
      }
      if (description) {
        description.required = rows.length > 1;
        description.setAttribute(
          'aria-label',
          `Descrierea variantei de preț ${index + 1}`
        );
      }
      if (remove) {
        remove.disabled = rows.length === 1;
      }
    });
  }

  if (priceEditor && priceTemplate) {
    priceEditor
      .querySelector('[data-add-price]')
      ?.addEventListener('click', () => {
        const rows = priceEditor.querySelector('[data-price-rows]');
        if (!rows || rows.children.length >= 20) return;
        rows.append(priceTemplate.content.cloneNode(true));
        updatePriceRows();
        rows.lastElementChild
          ?.querySelector('[name="pret_valoare"]')
          ?.focus();
      });

    priceEditor.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-price]');
      if (!remove) return;
      const rows = priceEditor.querySelector('[data-price-rows]');
      const row = remove.closest('[data-price-row]');
      if (!rows || !row || rows.children.length <= 1) return;
      row.remove();
      updatePriceRows();
    });
    updatePriceRows();
  }

  const scheduleModal = document.querySelector(
    '[data-schedule-modal]'
  );
  const scheduleOpenButton = document.querySelector(
    '[data-open-schedule-modal]'
  );

  if (scheduleModal && scheduleOpenButton) {
    const dialog = scheduleModal.querySelector(
      '.send-schedule-dialog'
    );
    const summary = scheduleModal.querySelector(
      '[data-send-summary]'
    );
    const appointmentOptions = scheduleModal.querySelector(
      '[data-send-appointment-options]'
    );
    const recipientSelector = scheduleModal.querySelector(
      '[data-recipient-selector]'
    );
    const recipientOptions = scheduleModal.querySelector(
      '[data-recipient-options]'
    );
    const currentFilter = scheduleModal.querySelector(
      '[data-send-current-filter]'
    );
    const messagePreview = scheduleModal.querySelector(
      '[data-send-message-preview]'
    );
    const crmLink = scheduleModal.querySelector(
      '[data-send-crm-link]'
    );
    const errorBox = scheduleModal.querySelector(
      '[data-send-error]'
    );
    const resultPanel = scheduleModal.querySelector(
      '[data-send-results]'
    );
    const sendButton = scheduleModal.querySelector(
      '[data-send-schedule-now]'
    );
    let selectedAppointmentIds = new Set();
    let selectedRecipientCodes = new Set();
    let availableAppointments = [];
    let previewInitialized = false;
    let idempotencyKey = '';
    let lastFocused = null;
    let previewController = null;
    let lastPreview = null;

    function element(tag, className, content) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (content !== undefined) node.textContent = content;
      return node;
    }

    function showScheduleError(message) {
      errorBox.textContent = String(message || '');
      errorBox.hidden = !message;
    }

    function selectedIdsFromUi() {
      return new Set(
        [
          ...appointmentOptions.querySelectorAll(
            'input[data-appointment-id]:checked'
          )
        ].map(input => Number(input.value))
      );
    }

    function selectedRecipientsFromUi() {
      return new Set(
        [
          ...recipientOptions.querySelectorAll(
            'input[data-recipient-code]:checked'
          )
        ].map(input => input.value)
      );
    }

    function renderRecipientChoices(data) {
      recipientOptions.replaceChildren();
      recipientSelector.hidden = data.sender.associated;

      if (data.sender.associated) return;
      data.availableRecipientMembers.forEach(member => {
        const label = element('label', 'send-recipient-option');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = member.code;
        input.dataset.recipientCode = member.code;
        input.checked = selectedRecipientCodes.has(member.code);
        const copy = element('span');
        copy.append(
          element('strong', '', member.name),
          element('small', '', member.numbers.join(', '))
        );
        label.append(input, copy);
        recipientOptions.append(label);
      });
    }

    function renderAppointmentChoices(data) {
      appointmentOptions.replaceChildren();
      const groups = new Map();
      availableAppointments.forEach(appointment => {
        const key = appointment.technicianCode;
        if (!groups.has(key)) {
          groups.set(key, {
            name: appointment.technician,
            appointments: []
          });
        }
        groups.get(key).appointments.push(appointment);
      });

      groups.forEach((group, code) => {
        const section = element('section', 'send-technician-group');
        const groupLabel = element(
          'label',
          'send-technician-toggle'
        );
        const groupToggle = document.createElement('input');
        groupToggle.type = 'checkbox';
        groupToggle.dataset.technicianCode = code;
        groupToggle.checked = group.appointments.every(item =>
          selectedAppointmentIds.has(item.id)
        );
        groupToggle.indeterminate =
          !groupToggle.checked &&
          group.appointments.some(item =>
            selectedAppointmentIds.has(item.id)
          );
        groupLabel.append(
          groupToggle,
          element(
            'strong',
            '',
            `${group.name} (${group.appointments.length})`
          )
        );
        section.append(groupLabel);

        group.appointments.forEach(appointment => {
          const label = element(
            'label',
            'send-appointment-option'
          );
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = String(appointment.id);
          input.dataset.appointmentId = String(appointment.id);
          input.dataset.technicianCode = code;
          input.checked = selectedAppointmentIds.has(
            appointment.id
          );
          const copy = element('span');
          copy.append(
            element(
              'strong',
              '',
              `${appointment.interval} — ${appointment.type}`
            ),
            element(
              'small',
              '',
              `${appointment.client} · ${appointment.address}`
            )
          );
          label.append(input, copy);
          section.append(label);
        });
        appointmentOptions.append(section);
      });

      if (!data.appointments.length) {
        appointmentOptions.append(
          element(
            'p',
            'empty',
            'Nu există programări pentru selecția curentă.'
          )
        );
      }
    }

    function renderScheduleSummary(data) {
      summary.replaceChildren();
      const list = element('dl', 'send-summary-grid');
      const entries = [
        ['Inițiator', data.sender.name],
        ['Data programului', data.date.split('-').reverse().join('.')],
        [
          'Tehnicieni incluși',
          data.technicians.join(', ') || 'Niciunul'
        ],
        ['Programări', String(data.count)],
        [
          'Destinatari',
          data.recipients.length
            ? data.recipients
                .map(item =>
                  `${item.memberName} — ${item.maskedNumber}`
                )
                .join('; ')
            : 'Neselectați'
        ]
      ];
      entries.forEach(([label, value]) => {
        list.append(
          element('dt', '', label),
          element('dd', '', value)
        );
      });
      summary.append(list);
    }

    function refreshSendButton() {
      sendButton.disabled = Boolean(
        !lastPreview ||
        !lastPreview.count ||
        !lastPreview.recipients.length ||
        lastPreview.messageError
      );
    }

    async function loadSchedulePreview({
      preserveSelection = false
    } = {}) {
      previewController?.abort();
      previewController = new AbortController();
      showScheduleError('');
      sendButton.disabled = true;

      const params = new URLSearchParams({
        data: scheduleOpenButton.dataset.date || ''
      });
      const type = scheduleOpenButton.dataset.type || '';
      if (type) params.set('tip', type);
      if (currentFilter.checked) {
        params.set('only_current_filter', '1');
      }
      if (preserveSelection) {
        params.set('selection_present', '1');
        selectedAppointmentIds.forEach(id => {
          params.append('appointment_ids', String(id));
        });
      }
      selectedRecipientCodes.forEach(code => {
        params.append('recipient_members', code);
      });

      try {
        const response = await fetch(
          `/tehnician/programari/trimitere/preview?${params}`,
          {
            credentials: 'same-origin',
            signal: previewController.signal
          }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Previzualizarea a eșuat.');
        }

        lastPreview = data;
        if (!preserveSelection || !previewInitialized) {
          availableAppointments = [...data.appointments];
          selectedAppointmentIds = new Set(
            data.appointments.map(item => item.id)
          );
        }
        previewInitialized = true;
        renderRecipientChoices(data);
        renderAppointmentChoices(data);
        renderScheduleSummary(data);
        messagePreview.textContent =
          data.messageError ||
          data.message ||
          'Nu există mesaj de previzualizat.';
        crmLink.href = data.crmUrl;
        if (data.messageError) {
          showScheduleError(data.messageError);
        }
        refreshSendButton();
      } catch (error) {
        if (error.name === 'AbortError') return;
        lastPreview = null;
        showScheduleError(
          error.message || 'Previzualizarea a eșuat.'
        );
        refreshSendButton();
      }
    }

    function renderSendResults(operation) {
      resultPanel.replaceChildren();
      resultPanel.hidden = false;
      resultPanel.append(
        element(
          'h3',
          '',
          operation.dry_run
            ? 'Rezultat test — nu s-au trimis mesaje reale'
            : 'Rezultatul trimiterii'
        )
      );
      const list = element('ul', 'send-result-list');
      let hasFailure = false;
      operation.recipients.forEach(recipient => {
        const item = element(
          'li',
          `send-result-${recipient.status}`
        );
        const copy = element('div');
        copy.append(
          element(
            'strong',
            '',
            `${recipient.membru_nume} — ${recipient.numar_mascat}`
          ),
          element('span', '', recipient.status)
        );
        if (recipient.whatsapp_message_id) {
          copy.append(
            element(
              'small',
              '',
              `ID mesaj: ${recipient.whatsapp_message_id}`
            )
          );
        }
        if (recipient.eroare_sigura) {
          copy.append(
            element('small', '', recipient.eroare_sigura)
          );
        }
        item.append(copy);
        list.append(item);
        if (recipient.status === 'esuat') hasFailure = true;
      });
      resultPanel.append(list);
      if (hasFailure) {
        const retry = element(
          'button',
          'button ghost',
          'Reîncearcă doar mesajele eșuate'
        );
        retry.type = 'button';
        retry.dataset.retryOperation = operation.id;
        resultPanel.append(retry);
      }
    }

    async function postOperation(url, params = new URLSearchParams()) {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8',
          'X-CSRF-Token': token || ''
        },
        body: params
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Operațiunea a eșuat.');
      }
      return data.operation;
    }

    async function sendSchedule() {
      selectedAppointmentIds = selectedIdsFromUi();
      selectedRecipientCodes = selectedRecipientsFromUi();
      const params = new URLSearchParams({
        data: scheduleOpenButton.dataset.date || '',
        idempotency_key: idempotencyKey
      });
      selectedAppointmentIds.forEach(id => {
        params.append('appointment_ids', String(id));
      });
      selectedRecipientCodes.forEach(code => {
        params.append('recipient_members', code);
      });

      sendButton.disabled = true;
      sendButton.textContent = 'Se trimite…';
      showScheduleError('');
      try {
        const operation = await postOperation(
          '/tehnician/programari/trimitere',
          params
        );
        renderSendResults(operation);
      } catch (error) {
        showScheduleError(error.message);
      } finally {
        sendButton.textContent = 'Trimite acum';
        refreshSendButton();
      }
    }

    async function retryOperation(operationId, button) {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Se reîncearcă…';
      showScheduleError('');
      try {
        const operation = await postOperation(
          `/tehnician/programari/trimitere/${operationId}/retry`
        );
        renderSendResults(operation);
      } catch (error) {
        showScheduleError(error.message);
      } finally {
        button.textContent = original;
        button.disabled = false;
      }
    }

    function closeScheduleModal() {
      scheduleModal.hidden = true;
      document.body.classList.remove('schedule-modal-open');
      previewController?.abort();
      lastFocused?.focus();
    }

    function openScheduleModal() {
      lastFocused = document.activeElement;
      selectedAppointmentIds = new Set();
      selectedRecipientCodes = new Set();
      availableAppointments = [];
      previewInitialized = false;
      lastPreview = null;
      idempotencyKey = crypto.randomUUID();
      currentFilter.checked = false;
      resultPanel.hidden = true;
      resultPanel.replaceChildren();
      showScheduleError('');
      scheduleModal.hidden = false;
      document.body.classList.add('schedule-modal-open');
      dialog.focus();
      loadSchedulePreview();
    }

    scheduleOpenButton.addEventListener(
      'click',
      openScheduleModal
    );
    scheduleModal
      .querySelectorAll('[data-close-schedule-modal]')
      .forEach(button => {
        button.addEventListener('click', closeScheduleModal);
      });
    currentFilter.addEventListener('change', () => {
      selectedAppointmentIds = new Set();
      previewInitialized = false;
      loadSchedulePreview();
    });
    appointmentOptions.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.technicianCode &&
          !target.dataset.appointmentId) {
        appointmentOptions
          .querySelectorAll(
            `input[data-appointment-id][data-technician-code="${CSS.escape(target.dataset.technicianCode)}"]`
          )
          .forEach(input => {
            input.checked = target.checked;
          });
      }
      selectedAppointmentIds = selectedIdsFromUi();
      loadSchedulePreview({ preserveSelection: true });
    });
    recipientOptions.addEventListener('change', () => {
      selectedRecipientCodes = selectedRecipientsFromUi();
      selectedAppointmentIds = selectedIdsFromUi();
      loadSchedulePreview({ preserveSelection: true });
    });
    sendButton.addEventListener('click', sendSchedule);

    scheduleModal.addEventListener('click', event => {
      const retry = event.target.closest('[data-retry-operation]');
      if (retry) {
        retryOperation(retry.dataset.retryOperation, retry);
      }
    });

    document.addEventListener('keydown', event => {
      if (scheduleModal.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeScheduleModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...dialog.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ].filter(node => !node.closest('[hidden]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  document
    .querySelectorAll('[data-retry-operation]')
    .forEach(button => {
      if (button.closest('[data-schedule-modal]')) return;
      button.addEventListener('click', async () => {
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Se reîncearcă…';
        try {
          const response = await fetch(
            `/tehnician/programari/trimitere/${button.dataset.retryOperation}/retry`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'X-CSRF-Token': token || ''
              }
            }
          );
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Reîncercarea a eșuat.');
          }
          window.location.reload();
        } catch (error) {
          window.alert(error.message);
          button.disabled = false;
          button.textContent = original;
        }
      });
    });

  const toggle = document.querySelector('.mobile-menu-toggle');
  const backdrop = document.querySelector('.mobile-menu-backdrop');
  const sidebar = document.getElementById('crm-sidebar');

  if (!toggle || !backdrop || !sidebar) return;

  const setOpen = open => {
    document.body.classList.toggle('mobile-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute(
      'aria-label',
      open ? 'Închide meniul' : 'Deschide meniul'
    );
  };

  toggle.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('mobile-menu-open'));
  });

  backdrop.addEventListener('click', () => setOpen(false));

  sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setOpen(false);
      actionDropdowns.forEach(dropdown => {
        dropdown.removeAttribute('open');
      });
    }
  });
})();
