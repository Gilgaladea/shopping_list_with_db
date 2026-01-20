import tensorflow as tf
from tensorflow import keras
import json
import os

# Wczytaj model Keras
model = keras.models.load_model('models/model.h5')
print("✅ Model loaded")

try:
    # Eksportuj do SavedModel
    print("Exporting to SavedModel...")
    model.export('models/saved_model/')
    print("✅ SavedModel created")
    
    # Konwertuj do TFLite
    print("Converting to TFLite...")
    converter = tf.lite.TFLiteConverter.from_saved_model('models/saved_model/')
    tflite_model = converter.convert()
    
    with open('models/model.tflite', 'wb') as f:
        f.write(tflite_model)
    
    print("✅ TFLite model saved")
    print("\n📁 Files ready in models/:")
    print("  ✓ model.h5")
    print("  ✓ model.tflite")
    print("  ✓ metadata.json")
    print("  ✓ saved_model/")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()