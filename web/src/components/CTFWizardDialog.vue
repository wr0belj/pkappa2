<template>
  <v-dialog v-model="visible" width="500" @keydown.enter="submitCurrent">
    <v-card>
      <v-card-title>
        <span class="text-h5">CTF Setup Wizards</span>
      </v-card-title>
      <v-tabs v-model="tab" stacked color="primary">
        <v-tab value="tab_flag_regex">
          Setup Flag tags
          <v-icon>mdi-flag</v-icon>
        </v-tab>
        <v-tab value="tab_service">
          Setup Services
          <v-icon>mdi-cloud-outline</v-icon>
        </v-tab>
        <v-tab value="tab_import_tags">
          Import Tags
          <v-icon>mdi-tag-multiple</v-icon>
        </v-tab>
      </v-tabs>
      <v-tabs-window v-model="tab">
        <v-tabs-window-item value="tab_service">
          <v-form>
            <v-card-text>
              Create a service with a name, host and port.

              <v-text-field
                v-model="serviceName"
                label="Service name"
                autofocus
                :rules="[() => serviceName != '']"
              ></v-text-field>
              <v-text-field
                v-model="serviceHost"
                label="Host"
                :rules="[() => serviceHost != '']"
              ></v-text-field>
              <v-text-field
                v-model="servicePort"
                label="Port"
                type="number"
                :rules="[() => goodServicePort]"
              ></v-text-field>
            </v-card-text>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn variant="text" @click="visible = false">Cancel</v-btn>
              <v-btn
                variant="text"
                :disabled="
                  serviceName == '' ||
                  serviceHost == '' ||
                  !goodServicePort ||
                  service_loading
                "
                :loading="service_loading"
                :color="service_error ? 'error' : 'primary'"
                type="submit"
                @click="createService"
                >Create Service</v-btn
              >
            </v-card-actions>
          </v-form>
          <v-divider></v-divider>
          <v-card-text>
            <div class="text-subtitle-2 mb-2">Or import from CSV</div>
            <div class="text-caption mb-2">
              CSV file with columns: name, host, port
            </div>
            <v-file-input
              v-model="csvFile"
              label="Select CSV file"
              accept=".csv"
              density="compact"
              prepend-icon="mdi-file-delimited"
              @update:model-value="parseCSV"
            ></v-file-input>
            <v-table v-if="csvRows.length > 0" density="compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Host</th>
                  <th>Port</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in csvRows" :key="i">
                  <td>{{ row.name }}</td>
                  <td>{{ row.host }}</td>
                  <td>{{ row.port }}</td>
                </tr>
              </tbody>
            </v-table>
            <div v-if="csvError" class="text-error text-caption mt-1">
              {{ csvError }}
            </div>
          </v-card-text>
          <v-card-actions v-if="csvRows.length > 0">
            <v-spacer></v-spacer>
            <v-btn
              variant="text"
              :disabled="csv_loading"
              :loading="csv_loading"
              color="primary"
              @click="importCSV"
              >Import {{ csvRows.length }} Services</v-btn
            >
          </v-card-actions>
        </v-tabs-window-item>
        <v-tabs-window-item value="tab_import_tags">
          <v-card-text>
            <div class="text-caption mb-2">
              CSV file with columns: name, filter
            </div>
            <v-file-input
              v-model="tagCsvFile"
              label="Select CSV file"
              accept=".csv"
              density="compact"
              prepend-icon="mdi-file-delimited"
              @update:model-value="parseTagCSV"
            ></v-file-input>
            <v-table v-if="tagCsvRows.length > 0" density="compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Filter</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in tagCsvRows" :key="i">
                  <td>{{ row.name }}</td>
                  <td>{{ row.filter }}</td>
                </tr>
              </tbody>
            </v-table>
            <div v-if="tagCsvError" class="text-error text-caption mt-1">
              {{ tagCsvError }}
            </div>
          </v-card-text>
          <v-card-actions v-if="tagCsvRows.length > 0">
            <v-spacer></v-spacer>
            <v-btn
              variant="text"
              :disabled="tagCsv_loading"
              :loading="tagCsv_loading"
              color="primary"
              @click="importTagCSV"
              >Import {{ tagCsvRows.length }} Tags</v-btn
            >
          </v-card-actions>
        </v-tabs-window-item>
        <v-tabs-window-item value="tab_flag_regex">
          <v-form>
            <v-card-text>
              This wizard will create the two tags {{ flagInName }} and
              {{ flagOutName }} with the specified regex below if they don't
              already exist.

              <v-text-field
                v-model="flagRegex"
                label="Flag Regex"
                example="flag_[a-fA-F0-9]{32}"
                autofocus
                :rules="[() => goodFlagRegex]"
              ></v-text-field>
            </v-card-text>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn variant="text" @click="visible = false">Cancel</v-btn>
              <v-btn
                variant="text"
                :disabled="!goodFlagRegex || flag_regex_loading"
                :loading="flag_regex_loading"
                :color="flag_regex_error ? 'error' : 'primary'"
                type="submit"
                @click="createFlagTags"
                >Create Flag tags</v-btn
              >
            </v-card-actions>
          </v-form>
        </v-tabs-window-item>
      </v-tabs-window>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { EventBus } from "./EventBus";
import { ref, computed } from "vue";
import { useRootStore } from "@/stores";
import { randomColor } from "@/lib/colors";

const store = useRootStore();
const visible = ref(false);
const tab = ref("");

const flag_regex_loading = ref(false);
const flag_regex_error = ref(false);
const flagRegex = ref("");

const service_loading = ref(false);
const service_error = ref(false);
const serviceName = ref("");
const serviceHost = ref("");
const servicePort = ref("");

const csvFile = ref<File[]>([]);
const csvRows = ref<{ name: string; host: string; port: string }[]>([]);
const csvError = ref("");
const csv_loading = ref(false);

const tagCsvFile = ref<File[]>([]);
const tagCsvRows = ref<{ name: string; filter: string }[]>([]);
const tagCsvError = ref("");
const tagCsv_loading = ref(false);

const tagPrefix = "tag/";
const servicePrefix = "service/";
const flagInName = "flag_in";
const flagInColor = "#66ff66";
const flagInPrefix = "cdata:";
const flagOutName = "flag_out";
const flagOutColor = "#ff6666";
const flagOutPrefix = "sdata:";

EventBus.on("showCTFWizard", openDialog);

const goodServicePort = computed(() => {
  const p = parseInt(servicePort.value, 10);
  return !isNaN(p) && p > 0 && p <= 65535;
});

const goodFlagRegex = computed(() => {
  const v = flagRegex.value;
  if (v === "" || v.includes(" ")) return false;
  try {
    RegExp(v);
  } catch {
    return false;
  }
  return true;
});

function openDialog() {
  visible.value = true;
  tab.value = "tab_flag_regex";

  flag_regex_loading.value = false;
  flag_regex_error.value = false;

  service_loading.value = false;
  service_error.value = false;
  serviceName.value = "";
  serviceHost.value = "";
  servicePort.value = "";

  csvFile.value = [];
  csvRows.value = [];
  csvError.value = "";
  csv_loading.value = false;

  tagCsvFile.value = [];
  tagCsvRows.value = [];
  tagCsvError.value = "";
  tagCsv_loading.value = false;
}

function submitCurrent() {
  switch (tab.value) {
    case "tab_flag_regex":
      createFlagTags();
      break;
    case "tab_service":
      createService();
      break;
  }
}

function buildServiceQuery(host: string, port: string) {
  return `sport:${port} AND host:${host}`;
}

function createService() {
  service_loading.value = true;
  service_error.value = false;
  const query = buildServiceQuery(serviceHost.value, servicePort.value);
  store
    .addTag(servicePrefix + serviceName.value, query, randomColor())
    .then(() => {
      service_loading.value = false;
      EventBus.emit("showMessage", `Service ${serviceName.value} created.`);
    })
    .catch((err: Error) => {
      service_error.value = true;
      service_loading.value = false;
      EventBus.emit("showError", err.message);
    });
}

function parseCSV(files: File | File[]) {
  csvRows.value = [];
  csvError.value = "";
  if (!files || (Array.isArray(files) && files.length === 0)) return;
  const file = Array.isArray(files) ? files[0] : files;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    if (!text) return;
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      csvError.value = "CSV must have a header row and at least one data row.";
      return;
    }
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const hostIdx = header.indexOf("host");
    const portIdx = header.indexOf("port");
    if (nameIdx === -1 || hostIdx === -1 || portIdx === -1) {
      csvError.value = "CSV header must contain: name, host, port";
      return;
    }
    const rows: { name: string; host: string; port: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const name = cols[nameIdx] || "";
      const host = cols[hostIdx] || "";
      const port = cols[portIdx] || "";
      const p = parseInt(port, 10);
      if (!name || !host || isNaN(p) || p <= 0 || p > 65535) {
        csvError.value = `Invalid row ${i + 1}: name, host must be non-empty and port must be 1-65535.`;
        return;
      }
      rows.push({ name, host, port });
    }
    csvRows.value = rows;
  };
  reader.readAsText(file);
}

function importCSV() {
  csv_loading.value = true;
  Promise.allSettled(
    csvRows.value.map((row) =>
      store.addTag(
        servicePrefix + row.name,
        buildServiceQuery(row.host, row.port),
        randomColor(),
      ),
    ),
  )
    .then((res) => {
      const rejected = res.filter((r) => r.status === "rejected");
      if (rejected.length !== 0) {
        throw new Error(
          rejected.map((r) => r.reason as string).join("; "),
        );
      }
      csv_loading.value = false;
      EventBus.emit(
        "showMessage",
        `${csvRows.value.length} services imported.`,
      );
      csvRows.value = [];
      csvFile.value = [];
    })
    .catch((err: Error) => {
      csv_loading.value = false;
      EventBus.emit("showError", err.message);
    });
}

function parseTagCSV(files: File | File[]) {
  tagCsvRows.value = [];
  tagCsvError.value = "";
  if (!files || (Array.isArray(files) && files.length === 0)) return;
  const file = Array.isArray(files) ? files[0] : files;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    if (!text) return;
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      tagCsvError.value =
        "CSV must have a header row and at least one data row.";
      return;
    }
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const filterIdx = header.indexOf("filter");
    if (nameIdx === -1 || filterIdx === -1) {
      tagCsvError.value = "CSV header must contain: name, filter";
      return;
    }
    const rows: { name: string; filter: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const name = cols[nameIdx] || "";
      const filter = cols[filterIdx] || "";
      if (!name || !filter) {
        tagCsvError.value = `Invalid row ${i + 1}: name and filter must be non-empty.`;
        return;
      }
      rows.push({ name, filter });
    }
    tagCsvRows.value = rows;
  };
  reader.readAsText(file);
}

function importTagCSV() {
  tagCsv_loading.value = true;
  Promise.allSettled(
    tagCsvRows.value.map((row) =>
      store.addTag(tagPrefix + row.name, row.filter, randomColor()),
    ),
  )
    .then((res) => {
      const rejected = res.filter((r) => r.status === "rejected");
      if (rejected.length !== 0) {
        throw new Error(
          rejected
            .map((r) => r.reason as string)
            .join("; "),
        );
      }
      tagCsv_loading.value = false;
      EventBus.emit(
        "showMessage",
        `${tagCsvRows.value.length} tags imported.`,
      );
      tagCsvRows.value = [];
      tagCsvFile.value = [];
    })
    .catch((err: Error) => {
      tagCsv_loading.value = false;
      EventBus.emit("showError", err.message);
    });
}

function createFlagTags() {
  flag_regex_loading.value = true;
  flag_regex_error.value = false;
  Promise.allSettled([
    store.addTag(
      tagPrefix + flagInName,
      flagInPrefix + flagRegex.value,
      flagInColor,
    ),
    store.addTag(
      tagPrefix + flagOutName,
      flagOutPrefix + flagRegex.value,
      flagOutColor,
    ),
  ])
    .then((res) => {
      const rejected = res.filter((r) => r.status === "rejected");
      if (rejected.length != 0) {
        throw new Error(rejected.map((r) => r.reason as string).join("; "));
      }
      visible.value = false;
      flag_regex_loading.value = false;
    })
    .catch((err: Error) => {
      flag_regex_error.value = true;
      flag_regex_loading.value = false;
      EventBus.emit("showError", err.message);
    });
}
</script>
