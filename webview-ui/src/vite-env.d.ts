/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STUDY_MODE?: string
  readonly VITE_STUDY_SURVEY_URL?: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
