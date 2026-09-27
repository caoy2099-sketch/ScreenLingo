package io.screenlingo.mobile

import io.screenlingo.mobile.core.ModelSettings
import io.screenlingo.mobile.ui.MobileAction
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MobileViewModelTest {
  private val dispatcher = StandardTestDispatcher()
  private val privateSettings = ModelSettings(endpoint = "https://model.example/v1", model = "private-model")

  @Before fun setUp() { Dispatchers.setMain(dispatcher) }
  @After fun tearDown() { Dispatchers.resetMain() }

  private fun services(
    load: suspend () -> ModelSettings = { privateSettings },
    save: suspend (ModelSettings) -> ModelSettings = { it },
    translate: suspend (String, ModelSettings) -> String = { _, _ -> "译文" },
    explain: suspend (String, String, ByteArray?, ModelSettings) -> String = { _, _, _, _ -> "解释" },
  ) = MobileServices(load, save, { error("Unexpected image read") }, translate, explain)

  @Test fun coldTextShareWaitsForSavedProvider() = runTest(dispatcher) {
    val settings = CompletableDeferred<ModelSettings>()
    val recipients = mutableListOf<ModelSettings>()
    val model = MobileViewModel(services(load = { settings.await() }, translate = { _, selected ->
      recipients += selected
      "正确服务的译文"
    }))
    runCurrent()
    model.receiveText("Shared error")
    model.dispatch(MobileAction.Translate)
    runCurrent()
    assertTrue(recipients.isEmpty())
    settings.complete(privateSettings)
    advanceUntilIdle()
    assertEquals(listOf(privateSettings), recipients)
    assertEquals("正确服务的译文", model.state.value.result)
  }

  @Test fun cancelledContentOperationDoesNotCancelInitialization() = runTest(dispatcher) {
    val settings = CompletableDeferred<ModelSettings>()
    val recipients = mutableListOf<ModelSettings>()
    val model = MobileViewModel(services(load = { settings.await() }, translate = { _, selected ->
      recipients += selected; "译文"
    }))
    model.receiveText("First share")
    model.dispatch(MobileAction.Translate)
    runCurrent()
    model.dispatch(MobileAction.Cancel)
    model.receiveText("Second share")
    settings.complete(privateSettings)
    advanceUntilIdle()
    model.dispatch(MobileAction.Translate)
    advanceUntilIdle()
    assertEquals(listOf(privateSettings), recipients)
  }

  @Test fun failedSettingsLoadDoesNotSendToDefaultProvider() = runTest(dispatcher) {
    var requests = 0
    val model = MobileViewModel(services(load = { error("Cannot decrypt") }, translate = { _, _ ->
      requests++; "unexpected"
    }))
    model.receiveText("Private content")
    model.dispatch(MobileAction.Translate)
    advanceUntilIdle()
    assertEquals(0, requests)
    assertTrue(model.state.value.error.orEmpty().contains("本次没有发送内容"))
    model.dispatch(MobileAction.SaveSettings(privateSettings))
    advanceUntilIdle()
    model.dispatch(MobileAction.Translate)
    advanceUntilIdle()
    assertEquals(1, requests)
  }

  @Test fun newShareCannotCancelSettingsSaveAndTranslationWaits() = runTest(dispatcher) {
    val saveGate = CompletableDeferred<Unit>()
    val recipients = mutableListOf<ModelSettings>()
    val updated = privateSettings.copy(model = "updated-model")
    val model = MobileViewModel(services(save = { saveGate.await(); it }, translate = { _, selected ->
      recipients += selected; "译文"
    }))
    advanceUntilIdle()
    model.dispatch(MobileAction.SaveSettings(updated))
    runCurrent()
    model.receiveText("New share while saving")
    model.dispatch(MobileAction.Translate)
    runCurrent()
    assertTrue(model.state.value.settingsBusy)
    assertTrue(recipients.isEmpty())
    saveGate.complete(Unit)
    advanceUntilIdle()
    assertEquals(listOf(updated), recipients)
    assertFalse(model.state.value.settingsBusy)
  }

  @Test fun questionWaitsForInitialization() = runTest(dispatcher) {
    val settings = CompletableDeferred<ModelSettings>()
    val recipients = mutableListOf<ModelSettings>()
    val model = MobileViewModel(services(load = { settings.await() }, explain = { _, _, _, selected ->
      recipients += selected; "解释"
    }))
    model.receiveText("Explain error")
    model.dispatch(MobileAction.Ask("什么意思？", false))
    runCurrent()
    assertTrue(recipients.isEmpty())
    settings.complete(privateSettings)
    advanceUntilIdle()
    assertEquals(listOf(privateSettings), recipients)
  }

  @Test fun equalTextSharesStillInvalidatePreviousDialogConsent() = runTest(dispatcher) {
    val model = MobileViewModel(services())
    advanceUntilIdle()
    model.receiveText("Same OCR text")
    val previous = model.state.value.contentVersion
    model.receiveText("Same OCR text")
    assertTrue(model.state.value.contentVersion > previous)
    val beforeClear = model.state.value.contentVersion
    model.dispatch(MobileAction.ClearContent)
    assertTrue(model.state.value.contentVersion > beforeClear)
  }
}
