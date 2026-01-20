"""
Voice Command Classification CNN Model Training
================================================

This script trains a Convolutional Neural Network to classify voice commands
from audio spectrograms. The model predicts intents (ADD_PRODUCT, REMOVE_PRODUCT, etc.)
from shopping list commands.

Requirements:
    pip install tensorflow librosa numpy scipy scikit-learn tqdm

Dataset Structure:
    dataset/
    ├── add_product/
    │   ├── sample_1.wav
    │   ├── sample_2.wav
    │   └── ...
    ├── remove_product/
    │   ├── sample_1.wav
    │   └── ...
    └── other/
        ├── sample_1.wav
        └── ...

Each WAV file should be:
    - 16-bit PCM format
    - 16kHz sample rate
    - 1-3 seconds duration
    - Mono audio
"""

import os
import numpy as np
import librosa
from sklearn.model_selection import train_test_split
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import json
from pathlib import Path

# Parametry
DATASET_PATH = "dataset"
MODEL_OUTPUT_PATH = "models"
SAMPLE_RATE = 16000
DURATION = 3  # sekundy
N_MFCC = 13

# Utwórz folder models
os.makedirs(MODEL_OUTPUT_PATH, exist_ok=True)

# Wczytaj nagrania i konwertuj na MFCC
def load_and_process_audio(file_path):
    try:
        audio, sr = librosa.load(file_path, sr=SAMPLE_RATE, duration=DURATION)
        # Pad or trim to fixed length
        if len(audio) < SAMPLE_RATE * DURATION:
            audio = np.pad(audio, (0, SAMPLE_RATE * DURATION - len(audio)), mode='constant')
        else:
            audio = audio[:SAMPLE_RATE * DURATION]
        # Extract MFCC features
        mfcc = librosa.feature.mfcc(y=audio, sr=SAMPLE_RATE, n_mfcc=N_MFCC)
        return mfcc.T  # Shape: (time_steps, n_mfcc)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return None

# Wczytaj dataset
X = []
y = []
class_names = []
class_to_idx = {}

for idx, category in enumerate(sorted(os.listdir(DATASET_PATH))):
    category_path = os.path.join(DATASET_PATH, category)
    if not os.path.isdir(category_path):
        continue
    
    class_names.append(category)
    class_to_idx[category] = idx
    
    print(f"Loading {category}...")
    for audio_file in sorted(os.listdir(category_path)):
        if not audio_file.endswith('.wav'):
            continue
        
        file_path = os.path.join(category_path, audio_file)
        mfcc = load_and_process_audio(file_path)
        
        if mfcc is not None:
            X.append(mfcc)
            y.append(idx)

X = np.array(X)
y = np.array(y)

print(f"Dataset loaded: {X.shape[0]} samples")
print(f"Classes: {class_names}")

# Pad all sequences to same length
max_len = max([x.shape[0] for x in X])
X_padded = np.zeros((X.shape[0], max_len, N_MFCC))
for i, x in enumerate(X):
    X_padded[i, :x.shape[0], :] = x

X = X_padded
print(f"Padded shape: {X.shape}")

# Split dataset
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
X_train, X_val, y_train, y_val = train_test_split(X_train, y_train, test_size=0.2, random_state=42)

print(f"Train: {X_train.shape}, Val: {X_val.shape}, Test: {X_test.shape}")

# Buduj model
model = keras.Sequential([
    layers.Input(shape=(max_len, N_MFCC)),
    
    layers.Conv1D(32, 3, activation='relu', padding='same'),
    layers.BatchNormalization(),
    layers.MaxPooling1D(2),
    layers.Dropout(0.3),
    
    layers.Conv1D(64, 3, activation='relu', padding='same'),
    layers.BatchNormalization(),
    layers.MaxPooling1D(2),
    layers.Dropout(0.3),
    
    layers.Conv1D(128, 3, activation='relu', padding='same'),
    layers.BatchNormalization(),
    layers.MaxPooling1D(2),
    layers.Dropout(0.3),
    
    layers.GlobalAveragePooling1D(),
    
    layers.Dense(256, activation='relu'),
    layers.Dropout(0.5),
    
    layers.Dense(128, activation='relu'),
    layers.Dropout(0.3),
    
    layers.Dense(len(class_names), activation='softmax')
])

model.compile(
    optimizer='adam',
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy']
)

print(model.summary())

# Trenuj
history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=50,
    batch_size=16,
    verbose=1
)

# Ewaluacja
loss, accuracy = model.evaluate(X_test, y_test)
print(f"\nTest Accuracy: {accuracy:.4f}")

# Zapisz model w Keras format
model.save(os.path.join(MODEL_OUTPUT_PATH, "model.h5"))
print("Model saved as model.h5")

# Konwertuj do TensorFlow.js format
os.system(f"tensorflowjs_converter --input_format keras {os.path.join(MODEL_OUTPUT_PATH, 'model.h5')} {MODEL_OUTPUT_PATH}")
print("Model converted to TensorFlow.js format")

# Zapisz metadane
metadata = {
    "classes": class_names,
    "class_to_idx": class_to_idx,
    "sample_rate": SAMPLE_RATE,
    "n_mfcc": N_MFCC,
    "max_len": int(max_len),
    "accuracy": float(accuracy)
}

with open(os.path.join(MODEL_OUTPUT_PATH, "metadata.json"), "w") as f:
    json.dump(metadata, f, indent=2)

print("Metadata saved")
print(f"All files ready in: {MODEL_OUTPUT_PATH}/")
