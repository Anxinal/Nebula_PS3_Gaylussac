"""Rail corrugation condition monitoring - Random Forest + SHAP.

Modules
-------
config           Typed configuration for paths, features, model and CV.
signal_features  Pure signal-processing functions (speed, spectra, wavelength bands).
dataloader       Raw CSV -> cached feature matrix.
model            RandomForest wrapper with a SHAP TreeExplainer.
trainer          Cross-validation, decision-threshold tuning, final fit.
evaluator        Macro-F1 scoring and speed-confound diagnostics.
"""

__version__ = "0.1.0"
