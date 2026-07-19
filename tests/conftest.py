import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from nofinalstop.engine.data import get_registry


@pytest.fixture(scope="session")
def registry():
    return get_registry()
