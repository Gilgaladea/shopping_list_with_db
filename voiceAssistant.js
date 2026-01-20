// ========================================
// AUDIO PROCESSOR - Converts audio to spectrogram
// ========================================
class AudioProcessor {
  constructor(sampleRate = 16000) {
    this.sampleRate = sampleRate;
    this.audioContext = null;
    this.mediaStream = null;
    this.audioBuffer = [];
  }

  async initialize() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate
      });
      return true;
    } catch (error) {
      console.error("AudioContext initialization failed:", error);
      return false;
    }
  }

  async startRecording() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioBuffer = [];
      
      const source = this.audioContext.createMediaStreamAudioSource(this.mediaStream);
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (event) => {
        const inputData = event.inputData.getChannelData(0);
        this.audioBuffer.push(...Array.from(inputData));
      };
      
      source.connect(processor);
      processor.connect(this.audioContext.destination);
      
      return processor;
    } catch (error) {
      console.error("Microphone access denied:", error);
      throw error;
    }
  }

  stopRecording() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
  }

  // Convert audio samples to mel-spectrogram (simplified MFCC-like features)
  audioToSpectrogram(audioData) {
    // Normalize audio
    const maxValue = Math.max(...audioData.map(Math.abs));
    const normalized = audioData.map(v => v / (maxValue || 1));

    // Apply Hamming window
    const frameSize = 512;
    const frames = [];
    
    for (let i = 0; i < normalized.length - frameSize; i += frameSize / 2) {
      const frame = normalized.slice(i, i + frameSize);
      const windowed = this.applyHammingWindow(frame);
      frames.push(windowed);
    }

    // Compute FFT and mel-spectrogram (simplified)
    const spectrogram = frames.map(frame => this.computeMelSpectrogram(frame));
    
    return this.normalizeSpectrogram(spectrogram);
  }

  applyHammingWindow(frame) {
    const N = frame.length;
    return frame.map((val, n) => {
      const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * n / (N - 1));
      return val * window;
    });
  }

  computeMelSpectrogram(frame) {
    // Simplified FFT (using a basic approach for demo)
    // In production, use proper FFT library
    const fftSize = 512;
    const mel = new Array(128).fill(0);
    
    // Simple energy-based representation
    let energy = frame.reduce((sum, val) => sum + val * val, 0) / frame.length;
    
    for (let i = 0; i < 128; i++) {
      mel[i] = Math.log(energy + 1e-10) * (1 + Math.sin(i / 128));
    }
    
    return mel;
  }

  normalizeSpectrogram(spectrogram) {
    if (spectrogram.length === 0) return [];
    
    const flat = spectrogram.flat();
    const mean = flat.reduce((a, b) => a + b) / flat.length;
    const variance = flat.reduce((a, b) => a + Math.pow(b - mean, 2)) / flat.length;
    const std = Math.sqrt(variance);
    
    return spectrogram.map(frame =>
      frame.map(val => (val - mean) / (std || 1))
    );
  }

  // Convert spectrogram to tensor compatible with CNN
  spectrogramToTensor(spectrogram, targetWidth = 43) {
    let padded = spectrogram;
    
    // Pad or trim to target width
    if (padded.length < targetWidth) {
      const padding = targetWidth - padded.length;
      padded = [...padded, ...Array(padding).fill(new Array(128).fill(0))];
    } else if (padded.length > targetWidth) {
      padded = padded.slice(0, targetWidth);
    }

    // Reshape to [1, 128, 43, 1] for CNN input
    const flat = padded.flat();
    return tf.tensor4d(flat, [1, 128, 43, 1]);
  }
}

// ========================================
// VOICE ASSISTANT - Main controller
// ========================================
class VoiceAssistant {
  constructor() {
    this.audioProcessor = null;
    this.model = null;
    this.isListening = false;
    this.recordingProcessor = null;
    this.categories = ["dairy", "bread", "fruits", "vegetables", "meat", "fish",
                       "dry", "frozen", "beverages", "snacks", "other"];
    this.recognition = null;
    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
    }
  }

  async initialize() {
    this.audioProcessor = new AudioProcessor();
    const initialized = await this.audioProcessor.initialize();
    
    if (!initialized) {
      this.showStatus("Failed to initialize audio", "error");
      return false;
    }

    await this.loadModel();
    this.setupEventListeners();
    return true;
  }

  async loadModel() {
    try {
      this.showStatus("Loading voice model...", "processing");
      // Model will be loaded from trained dataset
      // Placeholder for now
      this.model = null;
      this.metadata = await (await fetch('./models/metadata.json')).json();
      console.log("Model metadata loaded");
      console.log("Classes:", this.metadata.classes);
      this.showStatus("Ready to use voice commands", "success");
    } catch (error) {
      console.log("Metadata not found, voice model will be added later", error);
    }
  }

  setupEventListeners() {
    const voiceBtn = document.getElementById("voiceButton");
    if (voiceBtn) {
      voiceBtn.addEventListener("click", () => this.toggleListening());
    }
  }

  async toggleListening() {
    if (this.isListening) {
      await this.stopListening();
    } else {
      await this.startListening();
    }
  }

  async startListening() {
    if (!cookiesAccepted) {
      this.showStatus(translations[currentLang].cookieRequiredForVoice, "error");
      return;
    }

    this.isListening = true;
    this.updateButtonState(true);
    this.showStatus(translations[currentLang].listeningForCommand, "processing");

    try {
      this.recordingProcessor = await this.audioProcessor.startRecording();
      
      // Record for 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      await this.processAudio();
    } catch (error) {
      console.error("Recording error:", error);
      this.showStatus(translations[currentLang].microphoneAccessDenied, "error");
    } finally {
      await this.stopListening();
    }
  }

  async stopListening() {
    this.isListening = false;
    this.updateButtonState(false);
    this.audioProcessor.stopRecording();
  }

  async processAudio() {
    this.showStatus(translations[currentLang].processingAudio, "processing");
    // Use speech-to-text directly (no CNN model yet)
    await this.getProductNameFromSpeech();
  }

  async getProductNameFromSpeech() {
    if (!this.recognition) {
      this.showStatus(translations[currentLang].speechRecognitionNotSupported, "error");
      return;
    }

    return new Promise((resolve) => {
      let transcript = "";

      this.recognition.onstart = () => {
        transcript = "";
      };

      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
      };

      this.recognition.onend = () => {
        this.processCommand(transcript);
        resolve();
      };

      this.recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        this.showStatus(`Error: ${event.error}`, "error");
        resolve();
      };

      try {
        const lang = currentLang === "pl" ? "pl-PL" : "en-US";
        this.recognition.lang = lang;
        this.recognition.start();
      } catch (error) {
        console.error("Failed to start speech recognition:", error);
        resolve();
      }
    });
  }
  processCommand(transcript) {
    if (!transcript) {
      this.showStatus(translations[currentLang].couldNotUnderstand, "error");
      return;
    }

    transcript = transcript.toLowerCase().trim();
    console.log("Transcript:", transcript);

    // Parse command to determine type and extract product name
    const commandData = this.parseCommand(transcript);
    
    if (!commandData.productName) {
      this.showStatus(
        `${translations[currentLang].couldNotExtractProduct}: "${transcript}"`,
        "error"
      );
      return;
    }

    // Execute appropriate action based on command type
    switch (commandData.command) {
      case "REMOVE_FROM_LIST":
        this.findAndUnmarkProduct(commandData.productName);
        break;
      case "ADD_NEW_PRODUCT":
        this.addNewProductToDb(commandData.productName, commandData.category);
        break;
      case "ADD_TO_LIST":
        this.findAndMarkProduct(commandData.productName, commandData.category);
        break;
    }
  }

  findAndMarkProduct(productName, suggestedCategory) {
    // Search for existing product with this name
    const existingProduct = shoppingList.find(item => 
      item.name.toLowerCase() === productName.toLowerCase()
    );

    if (existingProduct) {
      // Mark as toBuy if not already
      if (!existingProduct.toBuy) {
        toggleToBuy(existingProduct.id);
      }
      
      this.showStatus(
        `${translations[currentLang].addedProduct}: ${existingProduct.name}`,
        "success"
      );
      this.speakConfirmation(existingProduct.name, existingProduct.category, false);
    } else {
      // Product doesn't exist - create it and mark as toBuy
      addProductToDB(productName, suggestedCategory || "other").then(() => {
        // Find the newly created product and mark it as toBuy
        const newProduct = shoppingList.find(item => 
          item.name.toLowerCase() === productName.toLowerCase()
        );
        if (newProduct) {
          toggleToBuy(newProduct.id);
        }
        
        this.showStatus(
          `${translations[currentLang].addedProduct}: ${productName}`,
          "success"
        );
        this.speakConfirmation(productName, suggestedCategory || "other", false);
      });
    }
  }

  findAndUnmarkProduct(productName) {
    // Search for product that contains the spoken name
    const product = shoppingList.find(item => 
      item.name.toLowerCase().includes(productName.toLowerCase()) ||
      productName.toLowerCase().includes(item.name.toLowerCase())
    );
    
    if (product && product.toBuy) {
      // Uncheck from shopping list
      toggleToBuy(product.id);
      const message = currentLang === "pl" 
        ? `Usunąłem ${product.name} z listy`
        : `Removed ${product.name} from the list`;
      this.showStatus(message, "success");
      this.speakFeedback(message);
    } else if (product && !product.toBuy) {
      const message = currentLang === "pl"
        ? `${product.name} nie jest na liście zakupów`
        : `${product.name} is not on the shopping list`;
      this.showStatus(message, "error");
      this.speakFeedback(message);
    } else {
      const message = currentLang === "pl"
        ? `Nie znalazłem produktu: ${productName}`
        : `Product not found: ${productName}`;
      this.showStatus(message, "error");
      this.speakFeedback(message);
    }
  }

  addNewProductToDb(productName, category) {
    addProductToDB(productName, category || "other");
    const message = currentLang === "pl"
      ? `Dodałem ${productName} do katalogu`
      : `Added ${productName} to catalog`;
    this.showStatus(`${translations[currentLang].addedProduct} to catalog: ${productName}`, "success");
    this.speakFeedback(message);
  }

  parseCommand(transcript) {
    const lowerTranscript = transcript.toLowerCase();
    
    // Check for REMOVE command
    const isRemoveCommand = /usuń|remove|wyrzuć|delete|skip/.test(lowerTranscript);
    
    // Check for ADD NEW PRODUCT command
    const isNewProductCommand = /nowy\s+produkt|new\s+product/.test(lowerTranscript);
    
    // Remove command keywords
    let cleaned = lowerTranscript
      .replace(/usuń\s+|remove\s+|wyrzuć\s+|delete\s+|skip\s+/i, "")
      .replace(/dodaj\s+nowy\s+produkt\s+|add\s+new\s+product\s+|nowy\s+produkt\s+|new\s+product\s+/i, "")
      .replace(/add\s+|dodaj\s+/i, "")
      .replace(/to\s+|na\s+|z\s+listy/i, "")
      .trim();

    let product = "";
    let category = null;

    // Find category keyword in cleaned text
    for (const cat of this.categories) {
      const categoryNames = [
        cat,
        translations.pl.categories[cat],
        translations.en.categories[cat]
      ];
      
      for (const name of categoryNames) {
        if (cleaned.toLowerCase().includes(name.toLowerCase())) {
          category = cat;
          // Remove category from product name
          product = cleaned
            .replace(new RegExp(name, "gi"), "")
            .trim();
          break;
        }
      }
      if (category) break;
    }

    // If no category found, use all cleaned words as product name
    if (!product) {
      product = cleaned;
    }

    // Determine command type
    let commandType = "ADD_TO_LIST";
    if (isRemoveCommand) {
      commandType = "REMOVE_FROM_LIST";
    } else if (isNewProductCommand) {
      commandType = "ADD_NEW_PRODUCT";
    }

    return {
      command: commandType,
      productName: product.charAt(0).toUpperCase() + product.slice(1) || "Unknown",
      category: category || "other"
    };
  }

  speakFeedback(message) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = currentLang === "pl" ? "pl-PL" : "en-US";
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  }

  speakConfirmation(product, category, isNewProduct = false) {
    if (!window.speechSynthesis) return;

    const message = isNewProduct
      ? (currentLang === "pl"
        ? `Dodałem ${product} do katalogu`
        : `Added ${product} to catalog`)
      : (currentLang === "pl"
        ? `Dodałem ${product} na listę zakupów`
        : `Added ${product} to shopping list`);

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = currentLang === "pl" ? "pl-PL" : "en-US";
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  }

  updateButtonState(listening) {
    const voiceBtn = document.getElementById("voiceButton");
    if (voiceBtn) {
      if (listening) {
        voiceBtn.classList.add("listening");
      } else {
        voiceBtn.classList.remove("listening");
      }
    }
  }

  showStatus(message, type = "info") {
    const statusEl = document.getElementById("voiceStatus");
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `voice-status show ${type}`;

    // Auto-hide after 5 seconds
    setTimeout(() => {
      statusEl.classList.remove("show");
    }, 5000);
  }
}

// ========================================
// INITIALIZATION
// ========================================
let voiceAssistant = null;

document.addEventListener("DOMContentLoaded", async () => {
  voiceAssistant = new VoiceAssistant();
  await voiceAssistant.initialize();
});
