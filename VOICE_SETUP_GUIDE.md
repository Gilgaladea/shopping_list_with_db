# Voice Assistant CNN - Complete Setup Guide

## Overview
This guide explains how to prepare your audio dataset, train the CNN model, and integrate it with your shopping list application.

## Step 1: Dataset Preparation

### 1.1 Create Dataset Directory Structure

Create the following folder structure in your project root:

```
dataset/
├── add_product/
├── remove_product/
├── get_list/
└── other/
```

### 1.2 Record Audio Samples

Record voice commands for each category. Each audio file should be:
- **Format**: WAV (16-bit PCM) or MP3
- **Sample Rate**: 16kHz (important for consistent preprocessing)
- **Duration**: 1-3 seconds per sample
- **Audio**: Mono (single channel)
- **Quality**: Clear speech, minimal background noise
- **Quantity**: Aim for 50-100+ samples per category (minimum 20-30 per category)

#### Recording Tips:
1. Use a quiet environment
2. Speak clearly and naturally
3. Vary your tone, speed, and accent
4. Record the same command multiple ways:
   - "add milk"
   - "add milk to dairy"
   - "add milk to the list"
   - "milk please add"

#### Tools for Recording:
- **Audacity** (free): https://www.audacityteam.org/
- **FFmpeg** (command line): `ffmpeg -f dshow -i audio="Microphone" output.wav`
- **Online**: https://www.mova.ai/en/voice-recorder
- **Python**: Use `sounddevice` or `PyAudio` with a recording script

#### Python Recording Script Example:
```python
import sounddevice as sd
import soundfile as sf

def record_audio(filename, duration=2, sr=16000):
    print(f"Recording {filename} for {duration} seconds...")
    audio = sd.rec(int(duration * sr), samplerate=sr, channels=1, dtype='float32')
    sd.wait()
    sf.write(filename, audio, sr)
    print(f"Saved to {filename}")

# Usage:
record_audio("dataset/add_product/sample_1.wav", duration=2)
```

### 1.3 Audio Conversion (if needed)

If your audio files have different sample rates or formats:

```bash
# Using FFmpeg to convert to 16kHz WAV:
ffmpeg -i input.mp3 -ar 16000 -ac 1 output.wav

# Batch convert:
for file in dataset/add_product/*.mp3; do
  ffmpeg -i "$file" -ar 16000 -ac 1 "${file%.mp3}.wav"
done
```

## Step 2: Install Python Dependencies

### 2.1 Create Virtual Environment (Optional but Recommended)

```bash
python -m venv voice_env
# On Windows:
voice_env\Scripts\activate
# On macOS/Linux:
source voice_env/bin/activate
```

### 2.2 Install Required Packages

```bash
pip install tensorflow librosa numpy scipy scikit-learn tqdm tensorflowjs
```

**Package Explanations:**
- `tensorflow`: Deep learning framework
- `librosa`: Audio processing and feature extraction
- `numpy`: Numerical computing
- `scipy`: Scientific computing utilities
- `scikit-learn`: Machine learning utilities
- `tqdm`: Progress bars
- `tensorflowjs`: Convert models for browser use

## Step 3: Train the Model

### 3.1 Run Training Script

```bash
python train_voice_model.py
```

The script will:
1. Scan the `dataset/` directory
2. Load and preprocess all audio files
3. Extract mel-spectrograms
4. Split data into train/val/test sets (70/20/10)
5. Build and train the CNN model
6. Evaluate on test set
7. Save the model
8. Convert to TensorFlow.js format

### 3.2 Training Output

The script creates:
```
models/
├── voice_model.h5          # Keras model (large, for retraining)
├── metadata.json           # Training metadata
├── classes.json            # Class names mapping
└── tfjs/                   # TensorFlow.js format
    ├── model.json
    └── group1-shard*.bin
```

### 3.3 Training Tips

- **More data = better accuracy**: Aim for 100+ samples per class
- **If overfitting**: Add more data or increase dropout (in train_voice_model.py)
- **If underfitting**: Add more training epochs or reduce dropout
- **Class imbalance**: Try to have similar number of samples per category
- **Monitor output**: Watch for validation accuracy plateau

Example output:
```
Epoch 45/50
150/150 [==============================] - 5s 33ms/step - loss: 0.1234 - accuracy: 0.9567 - val_loss: 0.2345 - val_accuracy: 0.9123

Test Accuracy: 0.9345
Test Loss: 0.2156

Model saved to: models/voice_model.h5
```

## Step 4: Integrate Model with Web App

### 4.1 Copy TensorFlow.js Model Files

Copy the TensorFlow.js format model to your web project:

```bash
# Copy from Python project to web project
cp -r models/tfjs/* your_web_project/models/
```

Create the directory structure:
```
shopping_list_with_db/
├── models/
│   ├── model.json
│   ├── group1-shard1of4.bin
│   ├── group1-shard2of4.bin
│   ├── group1-shard3of4.bin
│   └── group1-shard4of4.bin
├── index.html
├── voiceAssistant.js
└── ...
```

### 4.2 Update voiceAssistant.js

In the `loadModel()` function, update the model path:

```javascript
async loadModel() {
  try {
    this.showStatus("Loading CNN model...", "processing");
    
    // Load from local models directory
    this.model = await tf.loadLayersModel('file://./models/model.json');
    
    this.showStatus("Model loaded", "success");
  } catch (error) {
    console.log("Model not found. Using placeholder.", error);
    this.model = null;
  }
}
```

### 4.3 Serve Files Locally

To test locally, use a local server (not file:// protocol):

```bash
# Python 3
python -m http.server 8000

# Or Node.js (if installed)
npx http-server
```

Then visit: `http://localhost:8000`

## Step 5: Test Voice Assistant

1. Open the web app in your browser
2. Click the microphone button (🎤) in the bottom-right
3. Say a command (e.g., "add milk")
4. The app will:
   - Record audio for 3 seconds
   - Convert to spectrogram
   - Run through CNN
   - Extract product name via speech-to-text
   - Add to shopping list
   - Provide voice feedback

### Expected Behavior:

- Button pulses green when listening
- Status box shows current operation
- Audio feedback confirms action
- Product added to appropriate category

## Step 6: Troubleshooting

### Model Not Loading
```javascript
// Check browser console for errors
// Ensure model files are in correct directory
// Verify model.json path is correct
```

### Poor Accuracy
- Record more samples (target: 100+ per category)
- Ensure consistent audio quality
- Try different microphones
- Retrain model with larger dataset

### Microphone Not Working
- Check browser permissions
- Chrome/Firefox may need HTTPS for microphone access
- Check browser console for permission errors

### Model Too Large
- The trained model may be several MB
- Consider using a lighter architecture
- Quantize the model (TensorFlow.js supports this)

```javascript
// Example: Quantized model conversion
// In Python after training:
tfjs.converters.save_keras_model(model, './models/tfjs', {
    quantizationBytes: 2  // 16-bit quantization
})
```

## Advanced: Custom Commands

To add custom commands beyond "add product":

1. Create new directories in `dataset/`:
   ```
   dataset/
   ├── add_product/
   ├── remove_product/
   ├── clear_all/        # New
   └── list_items/       # New
   ```

2. Update `voiceAssistant.js` to handle new intents:
   ```javascript
   processCommand(transcript, intentIndex, confidence) {
     if (intentIndex === 0) {
       // ADD_PRODUCT
       this.extractAndAdd(transcript);
     } else if (intentIndex === 1) {
       // REMOVE_PRODUCT
       this.extractAndRemove(transcript);
     } else if (intentIndex === 2) {
       // CLEAR_ALL
       this.clearShoppingList();
     }
   }
   ```

3. Retrain model and update the web app

## Performance Metrics

Typical performance on ~100 samples per category:

| Metric | Value |
|--------|-------|
| Training Accuracy | 95-98% |
| Validation Accuracy | 90-94% |
| Test Accuracy | 88-92% |
| Inference Time | 50-200ms |
| Model Size | 5-10MB |

## Next Steps

1. Record dataset (50-100+ samples per category)
2. Train model: `python train_voice_model.py`
3. Copy TensorFlow.js files to `models/` directory
4. Update voiceAssistant.js with correct model path
5. Test voice commands in the web app
6. Fine-tune and iterate

## Resources

- [TensorFlow.js Documentation](https://www.tensorflow.org/js)
- [Librosa Documentation](https://librosa.org/)
- [Mel-Spectrogram Explanation](https://towardsdatascience.com/getting-to-know-the-mel-spectrogram-dc7ff1701228)
- [CNN Architectures for Audio](https://arxiv.org/abs/1704.04381)
- [Speech Recognition Deep Learning](https://pytorch.org/tutorials/intermediate/speech_recognition_with_torchaudio.html)

## Tips for Best Results

1. **Data Quality > Quantity**: 20 high-quality samples beat 200 noisy samples
2. **Consistent Recording Environment**: Record all samples in the same room/setup
3. **Diverse Samples**: Record same command with different intonations
4. **Regular Retraining**: As you use the app, collect more real examples and retrain
5. **Monitor Performance**: Track accuracy on test set after each training run
6. **Version Control**: Save model versions (v1, v2, etc.) to track improvements

---

**Questions or Issues?** Check the console (F12) for error messages and refer to the troubleshooting section.
