import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "giveget-test-"));
process.env.GIVEGET_DB = join(dir, "test.db");
process.env.GIVEGET_PHOTOS_DIR = join(dir, "photos");
process.env.NODE_ENV = "test";
process.env.DEV_LOGIN = "1";
