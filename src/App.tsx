import { lazy, Suspense, useEffect } from 'react'
import { initStore, restoreExplicitPresetConfig, useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, getExplicitUrlSettingsIds, hasUrlSettingParams } from './lib/urlSettings'
import { createDefaultOpenAIProfile, createSenseNovaU1Profile, hasDefaultPresetConfig, isAgentTextApiProfile, normalizeSettings } from './lib/apiProfiles'
import { isServerManagedApi } from './lib/serverManagedApi'
import { getCustomProviderConfigUrl, hasEmbeddedDefaultConfig, loadCustomProviderSettingsFromUrl, loadEmbeddedDefaultConfig } from './lib/customProviderConfigUrl'
import { getDefaultPresetProfileId, getPresetProfileIds, isPresetConfigOnlyEnabled, setPresetConfig } from './lib/presetConfig'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import AnnouncementCenter from './components/AnnouncementCenter'

const DetailModal = lazy(() => import('./components/DetailModal'))
const Lightbox = lazy(() => import('./components/Lightbox'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = lazy(() => import('./components/MaskEditorModal'))
const SupportPromptModal = lazy(() => import('./components/SupportPromptModal'))
const AgentWorkspace = lazy(() => import('./components/AgentWorkspace'))
const FavoriteCollectionsView = lazy(() => import('./components/FavoriteCollections').then((module) => ({ default: module.FavoriteCollectionsView })))
const FavoriteCollectionPickerModal = lazy(() => import('./components/FavoriteCollections').then((module) => ({ default: module.FavoriteCollectionPickerModal })))
const ManageCollectionsModal = lazy(() => import('./components/FavoriteCollections').then((module) => ({ default: module.ManageCollectionsModal })))

let defaultConfigImportStarted = false

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const showSettings = useStore((s) => s.showSettings)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  const favoritePickerTaskIds = useStore((s) => s.favoritePickerTaskIds)
  const isManageCollectionsModalOpen = useStore((s) => s.isManageCollectionsModalOpen)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    if (defaultConfigImportStarted) return
    defaultConfigImportStarted = true

    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const embeddedDefaultConfig = hasEmbeddedDefaultConfig()
    const loadDefaultConfig = () => embeddedDefaultConfig
      ? Promise.resolve().then(() => loadEmbeddedDefaultConfig())
      : loadCustomProviderSettingsFromUrl(customProviderConfigUrl)

    const applyUrlSettings = async (baseSettings: Partial<AppSettings>) => {
      const ids = getExplicitUrlSettingsIds(searchParams)
      const restored = await restoreExplicitPresetConfig(ids)
      const restoredSettings = useStore.getState().settings
      const sourceSettings = restored
        ? { ...restoredSettings, ...baseSettings, customProviders: restoredSettings.customProviders, profiles: restoredSettings.profiles }
        : baseSettings
      const nextSettings = buildSettingsFromUrlParams(sourceSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : sourceSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    void initStore()
      .then(async () => {
        const importedSettings = embeddedDefaultConfig || customProviderConfigUrl
          ? await loadDefaultConfig()
          : hasDefaultPresetConfig()
            ? {
                customProviders: [],
                profiles: [
                  { ...createDefaultOpenAIProfile(), isDefault: true },
                  ...(isServerManagedApi() ? [
                    ...['flare', 'sunburst'].map((variant) => createDefaultOpenAIProfile({
                      id: `gpt-image-2.5-${variant}`,
                      name: `GPT Image 2.5 ${variant === 'flare' ? 'Flare' : 'Sunburst'}`,
                      model: `gpt-image-2.5-${variant}`,
                      apiMode: 'images',
                      streamImages: false,
                    })),
                    createSenseNovaU1Profile(),
                  ] : []),
                ],
              }
            : null
        setPresetConfig(importedSettings)

        const state = useStore.getState()
        if (importedSettings) {
          await state.setPresetImportedSettings(importedSettings)
        } else if (state.previousPresetConfig) {
          await state.setPresetImportedSettings({ customProviders: [], profiles: [] })
        }

        const syncedState = useStore.getState()
        if (!importedSettings) {
          useStore.setState({ dismissedPresetProfileIds: [], dismissedPresetProviderIds: [] })
          if (syncedState.settings.profiles.some((profile) => profile.isDefault)) {
            syncedState.setSettings({
              profiles: syncedState.settings.profiles.map((profile) => profile.isDefault ? { ...profile, isDefault: undefined } : profile),
            })
          }
        }

        const current = useStore.getState()
        const presetIds = getPresetProfileIds()
        const defaultPresetId = getDefaultPresetProfileId()
        const settings = isPresetConfigOnlyEnabled()
          ? normalizeSettings({
              ...current.settings,
              activeProfileId: presetIds.has(current.settings.activeProfileId)
                ? current.settings.activeProfileId
                : defaultPresetId ?? [...presetIds][0],
              agentTextProfileId: current.settings.agentTextProfileId && presetIds.has(current.settings.agentTextProfileId)
                ? current.settings.agentTextProfileId
                : current.settings.profiles.find((profile) => presetIds.has(profile.id) && isAgentTextApiProfile(profile))?.id ?? null,
              agentImageProfileId: current.settings.agentImageProfileId && presetIds.has(current.settings.agentImageProfileId)
                ? current.settings.agentImageProfileId
                : defaultPresetId ?? [...presetIds][0],
            })
          : current.settings
        current.setSettings(await applyUrlSettings(settings))
        clearAppliedUrlSettings()
      })
      .catch((error) => {
        console.warn('Failed to import preset config:', error)
        setPresetConfig(null)
        const state = useStore.getState()
        void applyUrlSettings(state.settings).then((settings) => {
          useStore.getState().setSettings(settings)
          clearAppliedUrlSettings()
        })
      })
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <Header />
      {appMode === 'agent' ? (
        <Suspense fallback={<div className="min-h-[50vh]" aria-busy="true" />}>
          <AgentWorkspace />
        </Suspense>
      ) : (
        <main data-home-main data-drag-select-surface className="pb-48">
          <div className="safe-area-x max-w-7xl mx-auto">
            <AnnouncementCenter />
            <SearchBar />
            {filterFavorite && !activeFavoriteCollectionId ? (
              <Suspense fallback={null}>
                <FavoriteCollectionsView />
              </Suspense>
            ) : <TaskGrid />}
          </div>
        </main>
      )}
      <InputBar />
      <Suspense fallback={null}>
        {detailTaskId ? <DetailModal /> : null}
        {lightboxImageId ? <Lightbox /> : null}
        {showSettings ? <SettingsModal /> : null}
        {supportPromptOpen ? <SupportPromptModal /> : null}
        {maskEditorImageId ? <MaskEditorModal /> : null}
        {favoritePickerTaskIds?.length ? <FavoriteCollectionPickerModal /> : null}
        {isManageCollectionsModalOpen ? <ManageCollectionsModal /> : null}
      </Suspense>
      <ConfirmDialog />
      <Toast />
      <ImageContextMenu />
    </>
  )
}
